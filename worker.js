/**
 * Iris-Holistica AI Backend - Cloudflare Worker
 *
 * Този worker обработва заявки от фронтенда, като изпълнява следните стъпки:
 * 1.  Приема данни от формуляр, включително снимки на ляв и десен ирис.
 * 2.  Извлича RAG (Retrieval-Augmented Generation) контекста от трите KV ключа.
 * 3.  **Стъпка 1 (Визуален анализ):** Изпраща изображенията към Gemini 1.5 Flash заедно с Ключ 1 (`iris_diagnostic_map`), за да получи структуриран JSON списък с идентифицирани ирисови знаци.
 * 4.  **Стъпка 2 (Холистичен синтез):** Изпраща данните на потребителя, резултатите от визуалния анализ и Ключове 2 и 3 към Gemini 1.5 Flash, за да генерира крайния холистичен доклад.
 * 5.  Връща финалния доклад като JSON към фронтенда.
 */

// --- Конфигурация и константи ---

// URL на Gemini API. Моделите са 'gemini-1.5-flash-latest' за анализ на изображения и текстов синтез.
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

// CORS хедъри, които позволяват на вашия GitHub Pages фронтенд да комуникира с този worker.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://radilovk.github.io', // **ВАЖНО**: Променете, ако фронтендът е на друг домейн!
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

let aiConfigPromise;
async function loadAIConfig(env) {
  if (!aiConfigPromise) {
    aiConfigPromise = env.iris_config_kv.get('iris_config_kv', { type: 'json' });
  }
  return aiConfigPromise;
}

// --- Основен Handler на Worker-а ---

export default {
  async fetch(request, env, ctx) {
    // Справяне с CORS pre-flight заявки
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Обработка само на POST заявки
    if (request.method === 'POST') {
      try {
        const configPromise = loadAIConfig(env);
        ctx.waitUntil(configPromise);
        const config = await configPromise;
        return await handlePostRequest(request, env, config);
      } catch (error) {
        console.error('Критична грешка в worker-а:', error);
        return new Response(JSON.stringify({ error: 'Вътрешна грешка на сървъра: ' + error.message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
    }

    // Връщане на грешка за всички други методи
    return new Response(JSON.stringify({ error: 'Методът не е разрешен' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  },
}; 

// --- Логика за обработка на POST заявка ---

async function handlePostRequest(request, env, config) {
  // 1. Извличане на данни от формуляра
  const formData = await request.formData();
  const leftEyeFile = formData.get('left-eye-upload');
  const rightEyeFile = formData.get('right-eye-upload');
  
  // Валидация: Проверка дали са качени и двете снимки
  if (!leftEyeFile || !rightEyeFile || !(leftEyeFile instanceof File) || !(rightEyeFile instanceof File)) {
    return new Response(JSON.stringify({ error: 'Моля, качете снимки и на двете очи.' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Събиране на потребителските данни в един обект
  const userData = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') {
      userData[key] = value;
    }
  }

  // 2. Извличане на RAG контекста от KV
  const kvKeys = ['iris_diagnostic_map', 'holistic_interpretation_knowledge', 'remedy_and_recommendation_base'];
  const kvPromises = kvKeys.map(key => env.iris_rag_kv.get(key, { type: 'json' }));
  const [irisMap, interpretationKnowledge, remedyBase] = await Promise.all(kvPromises);
  
  if (!irisMap || !interpretationKnowledge || !remedyBase) {
      return new Response(JSON.stringify({ error: 'Не можахме да заредим базата данни за анализ. Моля, опитайте по-късно.' }), {
          status: 503, // Service Unavailable
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
  }


  // 3. Стъпка 1: Визуален анализ с Gemini Vision
  const [leftEyeAnalysisResult, rightEyeAnalysisResult] = await Promise.all([
    analyzeImageWithVision(leftEyeFile, 'ляво око', irisMap, env, config),
    analyzeImageWithVision(rightEyeFile, 'дясно око', irisMap, env, config)
  ]);

  // 4. Стъпка 2: Холистичен синтез с Gemini Pro
  const finalReport = await generateHolisticReport(
    userData,
    leftEyeAnalysisResult,
    rightEyeAnalysisResult,
    interpretationKnowledge,
    remedyBase,
    env,
    config
  );

  // 5. Връщане на финалния доклад
  return new Response(JSON.stringify(finalReport), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// --- Помощни функции за комуникация с AI ---

/**
 * Извиква Gemini 1.5 Flash за анализ на изображение.
 * @param {File} file - Файлът с изображението на ириса.
 * @param {string} eyeIdentifier - 'ляво око' или 'дясно око'.
 * @param {object} irisMap - JSON обектът от KV ключ 'iris_diagnostic_map'.
 * @param {string} apiKey - API ключът за Gemini.
 * @returns {Promise<object>} - JSON обект с резултатите от визуалния анализ.
 */
async function analyzeImageWithVision(file, eyeIdentifier, irisMap, env, config) {
  const base64Image = await arrayBufferToBase64(await file.arrayBuffer());

  const prompt = (config.analysis_prompt || '')
    .replace('{{EYE}}', eyeIdentifier)
    .replace('{{IRIS_MAP}}', JSON.stringify(irisMap));
  const model = config.analysis_model;

  let response;
  if (config.provider === 'openai') {
    const requestBody = {
      model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_base64: base64Image, mime_type: file.type }
          ]
        }
      ],
      response_format: { type: 'json_object' }
    };
    response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.openai_api_key}`,
      },
      body: JSON.stringify(requestBody),
    });
  } else {
    const requestBody = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: file.type, data: base64Image } }
        ]
      }],
      generationConfig: {
        response_mime_type: 'application/json',
      },
    };
    response = await fetch(`${GEMINI_API_URL}${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  }

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Грешка от ${config.provider} API (${model}): ${response.status}`, errorBody);
    throw new Error('Неуспешен визуален анализ на изображението.');
  }

  const data = await response.json();
  const jsonText = config.provider === 'openai'
    ? data.output?.[0]?.content?.[0]?.text || '{}'
    : data.candidates[0].content.parts[0].text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

  return JSON.parse(jsonText);
}

/**
 * Генерира крайния холистичен доклад с помощта на Gemini 1.5 Flash.
 * @param {object} userData - Данните, попълнени от потребителя.
 * @param {object} leftEyeAnalysis - Резултатът от визуалния анализ на лявото око.
 * @param {object} rightEyeAnalysis - Резултатът от визуалния анализ на дясното око.
 * @param {object} interpretationKnowledge - JSON обектът от KV ключ 'holistic_interpretation_knowledge'.
 * @param {object} remedyBase - JSON обектът от KV ключ 'remedy_and_recommendation_base'.
 * @param {string} apiKey - API ключът за Gemini.
 * @returns {Promise<object>} - Финалният JSON доклад за потребителя.
 */
async function generateHolisticReport(
  userData,
  leftEyeAnalysis,
  rightEyeAnalysis,
  interpretationKnowledge,
  remedyBase,
  env,
  config
) {
  const promptTemplate = config.report_prompt || '';
  const prompt = promptTemplate
    .replace('{{USER_DATA}}', JSON.stringify(userData, null, 2))
    .replace('{{LEFT_EYE_ANALYSIS}}', JSON.stringify(leftEyeAnalysis, null, 2))
    .replace('{{RIGHT_EYE_ANALYSIS}}', JSON.stringify(rightEyeAnalysis, null, 2))
    .replace('{{INTERPRETATION_KNOWLEDGE}}', JSON.stringify(interpretationKnowledge, null, 2))
    .replace('{{REMEDY_BASE}}', JSON.stringify(remedyBase, null, 2));
  const model = config.report_model;

  let response;
  if (config.provider === 'openai') {
    const requestBody = {
      model,
      input: [
        { role: 'user', content: [{ type: 'input_text', text: prompt }] }
      ],
      response_format: { type: 'json_object' }
    };
    response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.openai_api_key}`,
      },
      body: JSON.stringify(requestBody),
    });
  } else {
    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        response_mime_type: 'application/json',
      },
    };
    response = await fetch(`${GEMINI_API_URL}${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  }

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Грешка от ${config.provider} API (${model}): ${response.status}`, errorBody);
    throw new Error('Неуспешно генериране на холистичен доклад.');
  }

  const data = await response.json();
  const jsonText = config.provider === 'openai'
    ? data.output?.[0]?.content?.[0]?.text || '{}'
    : data.candidates[0].content.parts[0].text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

  return JSON.parse(jsonText);
}


// --- Други помощни функции ---

/**
 * Преобразува ArrayBuffer в Base64 низ.
 * @param {ArrayBuffer} buffer - Буферът с данни от файла.
 * @returns {Promise<string>} - Base64 кодиран низ.
 */
async function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
