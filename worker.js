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

// CORS хедъри, които позволяват на вашия GitHub Pages фронтенд да комуникира с този worker.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://radilovk.github.io', // **ВАЖНО**: Променете, ако фронтендът е на друг домейн!
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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
        return await handlePostRequest(request, env);
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

async function handlePostRequest(request, env) {
  // 1. Извличане на данни от формуляра
  const formData = await request.formData();
  const leftEyeFile = formData.get('left-eye-upload');
  const rightEyeFile = formData.get('right-eye-upload');

  // 1.1 Зареждане на конфигурация от KV
  const configKeys = ['AI_PROVIDER', 'AI_MODEL', 'ROLE_PROMPT'];
  let providerRaw, modelRaw, rolePromptRaw;
  if (env.iris_config_kv && typeof env.iris_config_kv.get === 'function') {
    [providerRaw, modelRaw, rolePromptRaw] = await Promise.all(
      configKeys.map(key => env.iris_config_kv.get(key))
    );
  }
  const provider = providerRaw || 'google';
  const model = modelRaw || 'gemini-1.5-flash-latest';
  let rolePrompt;
  try {
    rolePrompt = JSON.parse(rolePromptRaw || '{}').prompt;
  } catch (err) {}
  rolePrompt = rolePrompt || 'Ти си холистичен здравен консултант, специализиран в ирисова диагностика.';
  
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
    analyzeImageWithVision(leftEyeFile, 'ляво око', irisMap, env.GEMINI_API_KEY, model, rolePrompt, provider),
    analyzeImageWithVision(rightEyeFile, 'дясно око', irisMap, env.GEMINI_API_KEY, model, rolePrompt, provider)
  ]);

  // 4. Стъпка 2: Холистичен синтез с Gemini Pro
  const finalReport = await generateHolisticReport(
    userData,
    leftEyeAnalysisResult,
    rightEyeAnalysisResult,
    interpretationKnowledge,
    remedyBase,
    env.GEMINI_API_KEY,
    model,
    rolePrompt,
    provider
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
async function analyzeImageWithVision(file, eyeIdentifier, irisMap, apiKey, model, rolePrompt, provider = 'google') {
  if (provider !== 'google') {
    throw new Error('Неподдържан AI_PROVIDER: ' + provider);
  }
  const base64Image = await arrayBufferToBase64(await file.arrayBuffer());

  const prompt = `
    ${rolePrompt}
    Твоята ЕДИНСТВЕНА задача е да анализираш предоставената снимка на ${eyeIdentifier} и да идентифицираш всички видими знаци.
    Използвай предоставения JSON обект 'iris_diagnostic_map' като твой ЕДИНСТВЕН източник на информация за дефиниции, типове и топография.

    Твоят отговор ТРЯБВА да бъде само и единствено валиден JSON обект, без никакво друго обяснение или текст преди или след него.
    JSON обектът трябва да има следната структура:
    {
      "eye": "${eyeIdentifier}",
      "constitutional_analysis": {
        "color_type_guess": "Твоята преценка за цветния тип (напр. 'Лимфатична')",
        "structural_type_guess": "Твоята преценка за структурния тип (напр. 'Гъвкаво-адаптивен')"
      },
      "identified_signs": [
        {
          "sign_name": "Името на знака от irisMap (напр. 'Нервни пръстени')",
          "location": "Зона и/или сектор (напр. 'Зона 7, по цялата периферия')",
          "description": "Кратко описание на това, което виждаш (напр. 'Наличие на 3 дълбоки концентрични пръстена')"
        }
      ]
    }

    Ако не намериш знаци, върни празен масив за "identified_signs".

    Ето 'iris_diagnostic_map', който трябва да използваш:
    ${JSON.stringify(irisMap)}
  `;

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
  
  const response = await fetch(`${GEMINI_API_URL}${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Грешка от Gemini API (${model}): ${response.status}`, errorBody);
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
 * Генерира крайния холистичен доклад с помощта на Gemini 1.5 Flash.
 * @param {object} userData - Данните, попълнени от потребителя.
 * @param {object} leftEyeAnalysis - Резултатът от визуалния анализ на лявото око.
 * @param {object} rightEyeAnalysis - Резултатът от визуалния анализ на дясното око.
 * @param {object} interpretationKnowledge - JSON обектът от KV ключ 'holistic_interpretation_knowledge'.
 * @param {object} remedyBase - JSON обектът от KV ключ 'remedy_and_recommendation_base'.
 * @param {string} apiKey - API ключът за Gemini.
 * @returns {Promise<object>} - Финалният JSON доклад за потребителя.
 */
async function generateHolisticReport(userData, leftEyeAnalysis, rightEyeAnalysis, interpretationKnowledge, remedyBase, apiKey, model, rolePrompt, provider = 'google') {
  if (provider !== 'google') {
    throw new Error('Неподдържан AI_PROVIDER: ' + provider);
  }
  const prompt = `
    ${rolePrompt}
    Твоята задача е да синтезираш цялата предоставена информация в лесен за разбиране, структуриран и полезен доклад за потребителя на български език.

    **ВХОДНИ ДАННИ:**

    1.  **Потребителски данни:** ${JSON.stringify(userData, null, 2)}
    2.  **Визуален анализ на ляво око:** ${JSON.stringify(leftEyeAnalysis, null, 2)}
    3.  **Визуален анализ на дясно око:** ${JSON.stringify(rightEyeAnalysis, null, 2)}

    **БАЗА ЗНАНИЯ (RAG):**

    1.  **Знания за холистична интерпретация:** ${JSON.stringify(interpretationKnowledge, null, 2)}
    2.  **База с препоръки:** ${JSON.stringify(remedyBase, null, 2)}
    
    **ТВОЯТА ЗАДАЧА:**

    Създай финален доклад, който ТРЯБВА да бъде единствен валиден JSON обект, без обяснения преди или след него. Използвай предоставените данни и база знания, за да попълниш всяка секция. Бъди съпричастен, ясен и структуриран.

    **СТРУКТУРА НА ИЗХОДНИЯ JSON:**
    {
      "Име на пациента": "${userData.name || 'Не е посочено'}",
      "Конституционален анализ": "Напиши кратко резюме (2-3 изречения) за основния конституционален тип на база двата анализа (цвят и структура). Обясни какви са основните генетични предразположения.",
      "Анализ на елиминативните канали": "На база 'elimination_channels' от базата знания и намерените знаци, оцени състоянието на 5-те канала (черва, бъбреци, лимфа, кожа, бели дробове). Кои изглеждат най-натоварени?",
      "Приоритетни системи за подкрепа": "Идентифицирай 2-3 основни системи (напр. Нервна, Храносмилателна), които се нуждаят от най-голямо внимание според знаците и оплакванията на потребителя. Обоснови се кратко.",
      "Ключови находки и тяхната връзка": "Изброй 3-5 от най-значимите находки от двата ириса и обясни как те се свързват помежду си и с основните оплаквания на потребителя. Например, 'Наличието на нервни пръстени (стрес) е пряко свързано със спастичното състояние на червата, което виждаме в АНВ'.",
      "Холистични препоръки": {
        "Фундаментални принципи": "Започни с 2-3 от най-важните фундаментални принципи от 'foundational_principles', които са най-релевантни за този човек.",
        "Целенасочени препоръки": "Дай 3-4 конкретни, практически съвета от 'support_by_system_or_goal' или 'holistic_practices_library', които са насочени към 'Приоритетни системи за подкрепа'.",
        "Емоционална подкрепа": "На база 'psycho_emotional_links' и намерените знаци, предложи кратък коментар за възможна емоционална връзка, ако има такава. Бъди деликатен."
      },
      "Задължителен отказ от отговорност": "${remedyBase.mandatory_disclaimer.text}"
    }
  `;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    "generationConfig": {
        "response_mime_type": "application/json",
    }
  };

  const response = await fetch(`${GEMINI_API_URL}${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Грешка от Gemini API (${model}): ${response.status}`, errorBody);
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
