/**
 * Iris-Holistica AI Backend - Cloudflare Worker
 *
 * Този worker обработва заявки от фронтенда, като изпълнява следните стъпки:
 * 1.  Приема данни от формуляр, включително снимки на ляв и десен ирис.
 * 2.  **Извлича активната конфигурация (модел и промпти) от KV ключа `iris_config_kv`.**
 * 3.  Извлича RAG (Retrieval-Augmented Generation) контекста от другите KV ключове.
 * 4.  **Стъпка 1 (Визуален анализ):** Изпраща изображенията към конфигурирания AI модел за визия (`analysis_model`) с промпт от конфигурацията (`analysis_prompt_template`).
 * 5.  **Стъпка 2 (Холистичен синтез):** Изпраща данните на потребителя и резултатите от анализа към конфигурирания AI модел за текст (`report_model`) с промпт от конфигурацията (`report_prompt_template`).
 * 6.  Връща финалния доклад като JSON към фронтенда.
 */

// --- Конфигурация и константи ---

// Базови URL адреси за AI доставчици.
const API_BASE_URLS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models/'
  // 'openai': 'https://api.openai.com/v1/chat/completions' // Пример за бъдещо разширение
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://radilovk.github.io',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET, PUT',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// --- Основен Handler на Worker-а ---

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    
    // Добавяне на прост рутер за административни функции
    const url = new URL(request.url);
    if (url.pathname.startsWith('/admin/')) {
        // Логиката за админ панела ще бъде тук, за да се избегне втори worker
        // Засега връщаме 404, тъй като основният фокус е върху POST заявката
        // Тази част ще се изгради с административния панел
        return new Response(JSON.stringify({ error: 'Admin endpoint not fully implemented in this version.' }), {
            status: 404,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
    }

    if (request.method === 'POST') {
      try {
        return await handlePostRequest(request, env);
      } catch (error) {
        console.error('Критична грешка в worker-а:', error);
        return new Response(JSON.stringify({ error: 'Вътрешна грешка на сървъра: ' + error.message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Методът не е разрешен' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  },
};

// --- Логика за обработка на POST заявка ---

async function handlePostRequest(request, env) {
  // 1. Извличане на данни от формуляра
  const formData = await request.formData();
  const leftEyeFile = formData.get('left-eye-upload');
  const rightEyeFile = formData.get('right-eye-upload');
  
  if (!leftEyeFile || !rightEyeFile || !(leftEyeFile instanceof File) || !(rightEyeFile instanceof File)) {
    return new Response(JSON.stringify({ error: 'Моля, качете снимки и на двете очи.' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const userData = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') {
      userData[key] = value;
    }
  }

  // 2. Извличане на активната конфигурация и RAG контекста от KV
  const kvKeys = ['iris_config_kv', 'iris_diagnostic_map', 'holistic_interpretation_knowledge', 'remedy_and_recommendation_base'];
  const kvPromises = kvKeys.map(key => env.KV.get(key, { type: 'json' }));
  const [config, irisMap, interpretationKnowledge, remedyBase] = await Promise.all(kvPromises);

  if (!config) {
      return new Response(JSON.stringify({ error: 'Липсва конфигурация на AI асистента (iris_config_kv). Моля, конфигурирайте го от административния панел.' }), {
          status: 503, // Service Unavailable
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
  }
   if (!irisMap || !interpretationKnowledge || !remedyBase) {
      return new Response(JSON.stringify({ error: 'Не можахме да заредим базата данни за анализ. Моля, опитайте по-късно.' }), {
          status: 503, 
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
  }

  // 3. Стъпка 1: Визуален анализ с конфигурирания модел
  const [leftEyeAnalysisResult, rightEyeAnalysisResult] = await Promise.all([
    analyzeImageWithVision(leftEyeFile, 'ляво око', irisMap, config, env),
    analyzeImageWithVision(rightEyeFile, 'дясно око', irisMap, config, env)
  ]);

  // 4. Стъпка 2: Холистичен синтез с конфигурирания модел
  const finalReport = await generateHolisticReport(
    userData,
    leftEyeAnalysisResult,
    rightEyeAnalysisResult,
    interpretationKnowledge,
    remedyBase,
    config,
    env
  );

  // 5. Връщане на финалния доклад
  return new Response(JSON.stringify(finalReport), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// --- Помощни функции за комуникация с AI ---

/**
 * Извиква AI модел за анализ на изображение.
 * @param {File} file - Файлът с изображението на ириса.
 * @param {string} eyeIdentifier - 'ляво око' или 'дясно око'.
 * @param {object} irisMap - JSON обектът от KV ключ 'iris_diagnostic_map'.
 * @param {object} config - Активната конфигурация от 'iris_config_kv'.
 * @param {object} env - Worker средата, съдържаща API ключовете.
 * @returns {Promise<object>} - JSON обект с резултатите от визуалния анализ.
 */
async function analyzeImageWithVision(file, eyeIdentifier, irisMap, config, env) {
  const base64Image = await arrayBufferToBase64(await file.arrayBuffer());
  
  // Попълване на шаблона за промпт от конфигурацията
  const prompt = config.analysis_prompt_template
    .replace('{{EYE_IDENTIFIER}}', eyeIdentifier)
    .replace('{{IRIS_MAP}}', JSON.stringify(irisMap, null, 2));

  // Избор на API ключ и URL според доставчика
  const apiKey = config.provider === 'gemini' ? env.GEMINI_API_KEY : null; // Добавете други доставчици при нужда
  if (!apiKey) {
      throw new Error(`API ключ за доставчик '${config.provider}' не е намерен.`);
  }
  const apiUrl = `${API_BASE_URLS[config.provider]}${config.analysis_model}:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: file.type, data: base64Image } }
      ]
    }],
    "generationConfig": {
        "response_mime_type": "application/json",
    }
  };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Грешка от Vision API (${config.provider}): ${response.status}`, errorBody);
    throw new Error('Неуспешен визуален анализ на изображението.');
  }

  const data = await response.json();
  const jsonText = data.candidates[0].content.parts[0].text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();
    
  return JSON.parse(jsonText);
}

/**
 * Генерира крайния холистичен доклад с помощта на конфигурирания AI модел.
 * @param {object} userData - Данните, попълнени от потребителя.
 * @param {object} leftEyeAnalysis - Резултатът от визуалния анализ на лявото око.
 * @param {object} rightEyeAnalysis - Резултатът от визуалния анализ на дясното око.
 * @param {object} interpretationKnowledge - JSON обектът от KV ключ 'holistic_interpretation_knowledge'.
 * @param {object} remedyBase - JSON обектът от KV ключ 'remedy_and_recommendation_base'.
 * @param {object} config - Активната конфигурация от 'iris_config_kv'.
 * @param {object} env - Worker средата, съдържаща API ключовете.
 * @returns {Promise<object>} - Финалният JSON доклад за потребителя.
 */
async function generateHolisticReport(userData, leftEyeAnalysis, rightEyeAnalysis, interpretationKnowledge, remedyBase, config, env) {
  
  // Попълване на шаблона за промпт от конфигурацията
  const prompt = config.report_prompt_template
    .replace('{{USER_DATA}}', JSON.stringify(userData, null, 2))
    .replace('{{LEFT_EYE_ANALYSIS}}', JSON.stringify(leftEyeAnalysis, null, 2))
    .replace('{{RIGHT_EYE_ANALYSIS}}', JSON.stringify(rightEyeAnalysis, null, 2))
    .replace('{{INTERPRETATION_KNOWLEDGE}}', JSON.stringify(interpretationKnowledge, null, 2))
    .replace('{{REMEDY_BASE}}', JSON.stringify(remedyBase, null, 2))
    .replace('{{PATIENT_NAME}}', userData.name || 'Не е посочено')
    .replace('{{DISCLAIMER}}', remedyBase.mandatory_disclaimer.text);

  // Избор на API ключ и URL според доставчика
  const apiKey = config.provider === 'gemini' ? env.GEMINI_API_KEY : null; // Добавете други доставчици при нужда
  if (!apiKey) {
      throw new Error(`API ключ за доставчик '${config.provider}' не е намерен.`);
  }
  const apiUrl = `${API_BASE_URLS[config.provider]}${config.report_model}:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    "generationConfig": {
        "response_mime_type": "application/json",
    }
  };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Грешка от Text Generation API (${config.provider}): ${response.status}`, errorBody);
    throw new Error('Неуспешно генериране на холистичен доклад.');
  }

  const data = await response.json();
  const jsonText = data.candidates[0].content.parts[0].text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();

  return JSON.parse(jsonText);
}


// --- Други помощни функции ---

/**
 * Преобразува ArrayBuffer в Base64 низ.
 * @param {ArrayBuffer} buffer - Буферът с данни от файла.
 * @returns {string} - Base64 кодиран низ.
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
