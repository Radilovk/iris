/**
 * Iris-Holistica AI Backend - Cloudflare Worker
 *
 * Този worker има две основни функции:
 * 1.  Обработва POST заявки към главния път ('/') за извършване на AI анализ на ириси.
 * 2.  Действа като сигурен прокси за административни заявки към пътища '/admin/...',
 *     като използва Cloudflare API, за да управлява KV хранилището.
 */

// --- Конфигурация и константи ---

const API_BASE_URLS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models/',
  openai: 'https://api.openai.com/v1/chat/completions' // Базов URL за OpenAI
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // По-добре е да се смени с конкретния домейн на фронтенда
  'Access-Control-Allow-Methods': 'POST, GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// --- Основен Handler на Worker-а ---

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname.startsWith('/admin/')) {
      return handleAdminRequest(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/') {
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

    return new Response(JSON.stringify({ error: `Методът ${request.method} за път ${url.pathname} не е разрешен.` }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  },
};

// --- Логика за обработка на АДМИН заявки ---

async function handleAdminRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;

  // --- (НОВО) Рутер за управление на списъка с модели (използва директен достъп до KV) ---
  // Този подход е по-ефективен за четене/запис на единични, известни ключове.
  if (pathname.endsWith('/admin/models')) {
    if (method === 'GET') {
      try {
        const modelsListJson = await env.KV.get('iris_models_list') || '{}';
        const models = JSON.parse(modelsListJson);
        return new Response(JSON.stringify({ models }), { // admin.js очаква { models: ... }
          status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Невалиден JSON в `iris_models_list`: ' + err.message }), {
          status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }
    }

    if (method === 'PUT') {
      try {
        const newModelsList = await request.json();
        await env.iris_rag_kv.put('iris_models_list', JSON.stringify(newModelsList));
        return new Response(JSON.stringify({ success: true }), {
          status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Грешка при запис на списъка с модели: ' + err.message }), {
          status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }
    }
  }

  // --- Рутер-прокси към Cloudflare API за управление на конфигурации ---
  // Този подход е необходим за функции като изброяване на всички ключове (`/keys`).
  const { CF_ACCOUNT_ID, CF_API_TOKEN, CF_KV_NAMESPACE_ID } = env;
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !CF_KV_NAMESPACE_ID) {
    return new Response(JSON.stringify({ error: 'Cloudflare API credentials не са конфигурирани.' }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  const key = url.searchParams.get('key');
  const cfApiBase = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}`;
  const cfHeaders = { 'Authorization': `Bearer ${CF_API_TOKEN}` };

  let apiUrl;
  let cfMethod = request.method;
  let body = null;

  if (pathname.endsWith('/keys') && cfMethod === 'GET') {
    apiUrl = `${cfApiBase}/keys`;
  } else if (pathname.endsWith('/get') && cfMethod === 'GET' && key) {
    apiUrl = `${cfApiBase}/values/${encodeURIComponent(key)}`;
  } else if ((pathname.endsWith('/put') || pathname.endsWith('/set')) && cfMethod === 'PUT') {
    const reqBody = await request.json();
    apiUrl = `${cfApiBase}/values/${encodeURIComponent(reqBody.key)}`;
    body = reqBody.value;
    cfHeaders['Content-Type'] = 'text/plain';
  } else {
    return new Response(JSON.stringify({ error: 'Невалидна административна команда.' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  try {
    const response = await fetch(apiUrl, { method: cfMethod, headers: cfHeaders, body });
    if (!response.ok) {
      const errorText = await response.text();
      return new Response(JSON.stringify({ error: `Грешка от Cloudflare API: ${errorText}` }), {
        status: response.status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    if (pathname.endsWith('/keys')) {
      const data = await response.json();
      return new Response(JSON.stringify({ keys: data.result }), {
        status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    if (pathname.endsWith('/get')) {
      const value = await response.text();
      return new Response(JSON.stringify({ value: value }), {
        status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    if (pathname.endsWith('/put') || pathname.endsWith('/set')) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    return new Response(await response.text(), { status: response.status, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Вътрешна грешка в worker-а: ' + err.message }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}

// --- Логика за обработка на POST заявка (AI Анализ) ---

async function handlePostRequest(request, env) {
  // ... (Тази функция остава непроменена) ...
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

  const kvKeys = ['iris_config_kv', 'iris_diagnostic_map', 'holistic_interpretation_knowledge', 'remedy_and_recommendation_base'];
  const kvPromises = kvKeys.map(key => env.KV.get(key, { type: 'json' }));
  const [config, irisMap, interpretationKnowledge, remedyBase] = await Promise.all(kvPromises);

  if (!config) {
      return new Response(JSON.stringify({ error: 'Липсва конфигурация на AI асистента (iris_config_kv).' }), {
          status: 503,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
  }
   if (!irisMap || !interpretationKnowledge || !remedyBase) {
      return new Response(JSON.stringify({ error: 'Не можахме да заредим базата данни за анализ.' }), {
          status: 503, 
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
  }

  const apiKey = config.provider === 'gemini' ? env.GEMINI_API_KEY : (config.provider === 'openai' ? env.OPENAI_API_KEY : null);

  const [leftEyeAnalysisResult, rightEyeAnalysisResult] = await Promise.all([
    analyzeImageWithVision(leftEyeFile, 'ляво око', irisMap, config, apiKey),
    analyzeImageWithVision(rightEyeFile, 'дясно око', irisMap, config, apiKey)
  ]);

  const finalReport = await generateHolisticReport(
    userData, leftEyeAnalysisResult, rightEyeAnalysisResult,
    interpretationKnowledge, remedyBase, config, apiKey
  );

  return new Response(JSON.stringify(finalReport), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// --- Помощни функции за комуникация с AI ---

async function analyzeImageWithVision(file, eyeIdentifier, irisMap, config, apiKey) {
  if (config.provider !== 'gemini') {
    // OpenAI и други модели могат да изискват различна логика. Засега връщаме празен резултат.
    // TODO: Имплементирайте заявка към Vision модел на OpenAI, ако е необходимо.
    console.warn(`Визуален анализ за доставчик '${config.provider}' не е имплементиран. Пропускам стъпка 1.`);
    return { eye: eyeIdentifier, constitutional_analysis: {}, identified_signs: [] };
  }

  const base64Image = await arrayBufferToBase64(await file.arrayBuffer());
  const prompt = config.analysis_prompt_template
    .replace('{{EYE_IDENTIFIER}}', eyeIdentifier)
    .replace('{{IRIS_MAP}}', JSON.stringify(irisMap, null, 2));

  if (!apiKey) throw new Error(`API ключ за доставчик 'gemini' не е намерен.`);
  const apiUrl = `${API_BASE_URLS.gemini}${config.analysis_model}:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [{ parts: [ { text: prompt }, { inline_data: { mime_type: file.type, data: base64Image } } ] }],
    generationConfig: { "response_mime_type": "application/json" }
  };

  const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Грешка от Vision API (gemini): ${response.status}`, errorBody);
    throw new Error('Неуспешен визуален анализ на изображението.');
  }

  const data = await response.json();
  const jsonText = data.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(jsonText);
}

async function generateHolisticReport(userData, leftEyeAnalysis, rightEyeAnalysis, interpretationKnowledge, remedyBase, config, apiKey) {
  const prompt = config.report_prompt_template
    .replace('{{USER_DATA}}', JSON.stringify(userData, null, 2))
    .replace('{{LEFT_EYE_ANALYSIS}}', JSON.stringify(leftEyeAnalysis, null, 2))
    .replace('{{RIGHT_EYE_ANALYSIS}}', JSON.stringify(rightEyeAnalysis, null, 2))
    .replace('{{INTERPRETATION_KNOWLEDGE}}', JSON.stringify(interpretationKnowledge, null, 2))
    .replace('{{REMEDY_BASE}}', JSON.stringify(remedyBase, null, 2))
    .replace('{{PATIENT_NAME}}', userData.name || 'Не е посочено')
    .replace('{{DISCLAIMER}}', remedyBase.mandatory_disclaimer.text);

  if (!apiKey) throw new Error(`API ключ за доставчик '${config.provider}' не е намерен.`);
  
  // Логика за избор на API и тяло на заявката според доставчика
  let apiUrl, requestBody;
  if (config.provider === 'gemini') {
    apiUrl = `${API_BASE_URLS.gemini}${config.report_model}:generateContent?key=${apiKey}`;
    requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { "response_mime_type": "application/json" }
    };
  } else if (config.provider === 'openai') {
    apiUrl = API_BASE_URLS.openai;
    // OpenAI очаква различна структура на тялото на заявката
    requestBody = {
      model: config.report_model,
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" }
    };
  } else {
    throw new Error(`Доставчик '${config.provider}' не се поддържа.`);
  }

  const headers = {
      'Content-Type': 'application/json',
      'Authorization': config.provider === 'openai' ? `Bearer ${apiKey}` : undefined
  };

  const response = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(requestBody) });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Грешка от Text Generation API (${config.provider}): ${response.status}`, errorBody);
    throw new Error('Неуспешно генериране на холистичен доклад.');
  }

  const data = await response.json();
  let jsonText;
  
  if (config.provider === 'gemini') {
    jsonText = data.candidates[0].content.parts[0].text;
  } else if (config.provider === 'openai') {
    jsonText = data.choices[0].message.content;
  }
  
  jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(jsonText);
}

// --- Други помощни функции ---

/**
 * @returns {Promise<string>}
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
