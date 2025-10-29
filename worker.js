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
  openai: 'https://api.openai.com/v1/chat/completions'
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // За продукция: сменете с конкретния домейн
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

// --- Логика за обработка на АДМИН заявки (без промяна) ---

async function handleAdminRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;

  if (pathname.endsWith('/admin/models')) {
    if (method === 'GET') {
      try {
        const modelsListJson = await env.iris_rag_kv.get('iris_models_list') || '{}';
        const models = JSON.parse(modelsListJson);
        return new Response(JSON.stringify({ models }), { 
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
    if (typeof value !== 'string') continue;

    if (Object.prototype.hasOwnProperty.call(userData, key)) {
      if (Array.isArray(userData[key])) {
        userData[key].push(value);
      } else {
        userData[key] = [userData[key], value];
      }
    } else {
      userData[key] = value;
    }
  }

  const kvKeys = ['iris_config_kv', 'iris_diagnostic_map', 'holistic_interpretation_knowledge', 'remedy_and_recommendation_base'];
  const kvPromises = kvKeys.map(key => env.iris_rag_kv.get(key, { type: 'json' }));
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
    interpretationKnowledge, remedyBase, config, apiKey, env
  );

  return new Response(JSON.stringify(finalReport), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// --- Помощни функции за комуникация с AI ---

/**
 * *** КЛЮЧОВА ПРОМЯНА ***
 * Тази функция е напълно преработена, за да поддържа както Gemini, така и OpenAI за визуален анализ.
 * Вече няма да пропуска анализа на снимките, ако е избран OpenAI.
 */
async function analyzeImageWithVision(file, eyeIdentifier, irisMap, config, apiKey) {
  const prompt = config.analysis_prompt_template
    .replace('{{EYE_IDENTIFIER}}', eyeIdentifier)
    .replace('{{IRIS_MAP}}', JSON.stringify(irisMap, null, 2));

  const base64Image = await arrayBufferToBase64(await file.arrayBuffer());

  if (!apiKey) throw new Error(`API ключ за доставчик '${config.provider}' не е намерен.`);

  let apiUrl, requestBody, headers;

  if (config.provider === 'gemini') {
    apiUrl = `${API_BASE_URLS.gemini}${config.analysis_model}:generateContent?key=${apiKey}`;
    headers = { 'Content-Type': 'application/json' };
    requestBody = {
      contents: [{ parts: [ { text: prompt }, { inline_data: { mime_type: file.type, data: base64Image } } ] }],
      generationConfig: { "response_mime_type": "application/json" }
    };
  } else if (config.provider === 'openai') {
    // НОВА ЛОГИКА: Конструиране на заявка за OpenAI Vision API
    apiUrl = API_BASE_URLS.openai;
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };
    requestBody = {
      model: config.analysis_model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { "url": `data:${file.type};base64,${base64Image}` }
          }
        ]
      }],
      max_tokens: 2048,
      response_format: { type: "json_object" }
    };
  } else {
    // Fallback за неподдържан доставчик
    console.warn(`Визуален анализ за доставчик '${config.provider}' не е имплементиран. Пропускам стъпка 1.`);
    return { eye: eyeIdentifier, constitutional_analysis: {}, identified_signs: [] };
  }

  const response = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(requestBody) });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Грешка от Vision API (${config.provider}): ${response.status}`, errorBody);
    throw new Error(`Неуспешен визуален анализ на изображението с ${config.provider}.`);
  }

  const data = await response.json();
  let jsonText;

  if (config.provider === 'gemini') {
    jsonText = data.candidates[0].content.parts[0].text;
  } else if (config.provider === 'openai') {
    jsonText = data.choices[0].message.content;
  }
  
  jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
  
  try {
      return JSON.parse(jsonText);
  } catch (e) {
      console.error("Грешка при парсване на JSON от AI (визуален анализ):", jsonText);
      throw new Error("AI моделът върна невалиден JSON формат за визуалния анализ.");
  }
}

async function fetchExternalInsights(keywordHints, env) {
  if (!Array.isArray(keywordHints) || keywordHints.length === 0) {
    console.log('Външно търсене пропуснато – липсват ключови думи.');
    return [];
  }

  const endpoint = env.WEB_RESEARCH_ENDPOINT || 'https://serper.dev/search';
  const query = keywordHints.slice(0, 8).join(' ');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': env.WEB_RESEARCH_API_KEY,
      },
      body: JSON.stringify({ q: query }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('Външно търсене върна грешка:', response.status, errorText);
      return [];
    }

    const data = await response.json();
    const organicResults = Array.isArray(data.organic) ? data.organic : [];
    const limitedResults = organicResults.slice(0, 3)
      .map((item) => ({
        title: item.title || '',
        snippet: item.snippet || item.snippet_highlighted || '',
        url: item.link || item.url || '',
      }))
      .filter((item) => item.title || item.snippet || item.url);

    console.log(`Външни ключови думи: ${keywordHints.join(', ')} | върнати източници: ${limitedResults.length}`);

    return limitedResults;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      console.warn('Външно търсене прекъснато поради timeout.');
    } else {
      console.error('Грешка при извличане на външни инсайти:', error);
    }
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateHolisticReport(userData, leftEyeAnalysis, rightEyeAnalysis, interpretationKnowledge, remedyBase, config, apiKey, env) {
  const identifiedSigns = [
    ...((leftEyeAnalysis && Array.isArray(leftEyeAnalysis.identified_signs)) ? leftEyeAnalysis.identified_signs : []),
    ...((rightEyeAnalysis && Array.isArray(rightEyeAnalysis.identified_signs)) ? rightEyeAnalysis.identified_signs : [])
  ];

  const keywordSet = buildKeywordSet(identifiedSigns, userData);
  const { filteredKnowledge, matchedRemedyLinks } = selectRelevantInterpretationKnowledge(interpretationKnowledge, keywordSet);
  const relevantRemedyBase = selectRelevantRemedyBase(remedyBase, matchedRemedyLinks, keywordSet);

  const keywordHints = Array.from(keywordSet);
  const externalInsights = env && env.WEB_RESEARCH_API_KEY ? await fetchExternalInsights(keywordHints, env) : [];
  const externalPayload = JSON.stringify(externalInsights, null, 2);
  const hasExternalInsights = externalInsights.length > 0;
  const shouldExposeExternalContext = hasExternalInsights && externalPayload !== '[]';
  const promptUserData = { ...userData, keyword_hints: keywordHints };

  const interpretationPayload = JSON.stringify(filteredKnowledge, null, 2);
  const remedyPayload = JSON.stringify(relevantRemedyBase, null, 2);
  const disclaimerText = (remedyBase && remedyBase.mandatory_disclaimer && remedyBase.mandatory_disclaimer.text)
    ? remedyBase.mandatory_disclaimer.text
    : 'Важно: Този анализ е с образователна цел. Консултирайте се със специалист при здравословни въпроси.';

  const reportTemplate = typeof config.report_prompt_template === 'string'
    ? config.report_prompt_template
    : '';
  const externalContextPayload = shouldExposeExternalContext ? externalPayload : '[]';

  const prompt = reportTemplate
    .replace('{{USER_DATA}}', JSON.stringify(promptUserData, null, 2))
    .replace('{{LEFT_EYE_ANALYSIS}}', JSON.stringify(leftEyeAnalysis, null, 2))
    .replace('{{RIGHT_EYE_ANALYSIS}}', JSON.stringify(rightEyeAnalysis, null, 2))
    .replace('{{INTERPRETATION_KNOWLEDGE}}', interpretationPayload)
    .replace('{{REMEDY_BASE}}', remedyPayload)
    .replace('{{EXTERNAL_CONTEXT}}', externalContextPayload)
    .replace('{{PATIENT_NAME}}', userData.name || 'Не е посочено')
    .replace('{{DISCLAIMER}}', disclaimerText);

  if (!shouldExposeExternalContext && env && env.WEB_RESEARCH_API_KEY) {
    console.log('Външни източници не са намерени за текущия анализ.');
  }

  if (!apiKey) throw new Error(`API ключ за доставчик '${config.provider}' не е намерен.`);
  
  let apiUrl, requestBody, headers;

  if (config.provider === 'gemini') {
    apiUrl = `${API_BASE_URLS.gemini}${config.report_model}:generateContent?key=${apiKey}`;
    headers = { 'Content-Type': 'application/json' };
    requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { "response_mime_type": "application/json" }
    };
  } else if (config.provider === 'openai') {
    apiUrl = API_BASE_URLS.openai;
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };
    requestBody = {
      model: config.report_model,
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" }
    };
  } else {
    throw new Error(`Доставчик '${config.provider}' не се поддържа.`);
  }

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

  try {
      return JSON.parse(jsonText);
  } catch(e) {
      console.error("Грешка при парсване на JSON от AI (финален доклад):", jsonText);
      throw new Error("AI моделът върна невалиден JSON формат за финалния доклад.");
  }
}

/**
 * @param {unknown[]} identifiedSigns
 * @param {Record<string, unknown>} [userData={}]
 */
function buildKeywordSet(identifiedSigns, userData = {}) {
  const keywords = new Set();
  if (Array.isArray(identifiedSigns)) {
    for (const sign of identifiedSigns) {
      if (!sign || typeof sign !== 'object') continue;
      ['sign_name', 'description', 'location'].forEach((field) => {
        addValueToKeywords(keywords, sign[field]);
      });
    }
  }

  if (userData && typeof userData === 'object') {
    const stressSource = /** @type {Record<string, unknown>} */ (userData);
    const arrayLikeFields = ['main-goals', 'health-status'];
    for (const field of arrayLikeFields) {
      addValueToKeywords(keywords, stressSource[field]);
    }

    addValueToKeywords(keywords, stressSource['health-other']);
    addValueToKeywords(keywords, stressSource['family-history']);
    addValueToKeywords(keywords, stressSource['additional-notes']);
    addValueToKeywords(keywords, stressSource['free-text']);

    const numericContext = parseNumericContext(stressSource);

    if (numericContext.heightCm) {
      addKeywordVariants(keywords, `${Math.round(numericContext.heightCm)} cm`);
      keywords.add(`height_${Math.round(numericContext.heightCm)}cm`);
    }

    if (numericContext.weightKg) {
      addKeywordVariants(keywords, `${Math.round(numericContext.weightKg)} kg`);
      keywords.add(`weight_${Math.round(numericContext.weightKg)}kg`);
    }

    if (numericContext.ageYears !== undefined) {
      keywords.add(`age_${Math.round(numericContext.ageYears)}y`);
      if (numericContext.ageYears >= 45) {
        keywords.add('midlife_focus');
      }
    }

    if (numericContext.sleepHours !== undefined) {
      keywords.add(`sleep_${Math.round(numericContext.sleepHours)}h`);
      if (numericContext.sleepHours < 7) {
        keywords.add('недостатъчен сън');
        keywords.add('sleep_deficit');
      }
    }

    if (numericContext.waterLiters !== undefined) {
      keywords.add(`water_${numericContext.waterLiters.toFixed(1)}l`);
      if (numericContext.waterLiters < 1.5) {
        keywords.add('ниска хидратация');
        keywords.add('hydration_low');
      }
    }

    const stressValue = numericContext.stressLevel;
    if (stressValue !== undefined) {
      addValueToKeywords(keywords, `стрес ${stressValue}`);
      addValueToKeywords(keywords, `stress level ${stressValue}`);
      if (stressValue >= 7) {
        addValueToKeywords(keywords, 'високо ниво на стрес');
        addValueToKeywords(keywords, 'висок стрес');
      }
    }

    const bmiKeywordPayload = deriveBmiKeywords(numericContext.heightCm, numericContext.weightKg);
    for (const keyword of bmiKeywordPayload) {
      keywords.add(keyword);
    }

    const genderKeyword = deriveGenderKeyword(stressSource.gender ?? stressSource.sex);
    if (genderKeyword) {
      addKeywordVariants(keywords, genderKeyword);
      keywords.add(genderKeyword);
    }
  }

  return keywords;
}

function addKeywordVariants(set, value) {
  const normalized = value.toLowerCase();
  if (normalized) set.add(normalized);
  const slug = slugify(value);
  if (slug) set.add(slug);
  const words = normalized.split(/[^a-zа-я0-9]+/i).filter(word => word && word.length >= 4);
  for (const word of words) {
    set.add(word);
  }
}

function addValueToKeywords(set, value) {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      addValueToKeywords(set, item);
    }
    return;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    if (text) {
      addKeywordVariants(set, text);
      if (typeof value === 'string') {
        enhanceWithSynonyms(set, text);
      }
    }
  }
}

function parseNumericContext(source) {
  /** @type {{ heightCm?: number, weightKg?: number, ageYears?: number, waterLiters?: number, sleepHours?: number, stressLevel?: number }} */
  const context = {};

  const height = parseFloatValue(source.height ?? source['height-cm']);
  if (isValidRange(height, 90, 250)) {
    context.heightCm = height;
  }

  const weight = parseFloatValue(source.weight ?? source['weight-kg']);
  if (isValidRange(weight, 35, 300)) {
    context.weightKg = weight;
  }

  const age = parseFloatValue(source.age ?? source['age-years']);
  if (isValidRange(age, 0, 120)) {
    context.ageYears = age;
  }

  const water = parseFloatValue(source.water ?? source['water-intake']);
  if (isValidRange(water, 0, 12)) {
    context.waterLiters = water;
  }

  const sleep = parseFloatValue(source.sleep ?? source['sleep-hours']);
  if (isValidRange(sleep, 0, 24)) {
    context.sleepHours = sleep;
  }

  const stress = parseFloatValue(source.stress ?? source['stress-level']);
  if (isValidRange(stress, 0, 10)) {
    context.stressLevel = Math.round(stress);
  }

  return context;
}

function parseFloatValue(raw) {
  if (raw == null) return undefined;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw === 'string') {
    const normalized = raw
      .replace(/,/g, '.')
      .replace(/(cm|kg|l|литра|часа|ч|hrs?|hours?|kg|мм)/gi, '')
      .replace(/[^0-9.\-]/g, ' ');
    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    if (!match) return undefined;
    const value = Number.parseFloat(match[0]);
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}

function isValidRange(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function deriveBmiKeywords(heightCm, weightKg) {
  const bmiKeywords = new Set();
  if (!heightCm || !weightKg) {
    return bmiKeywords;
  }
  const heightMeters = heightCm / 100;
  if (heightMeters <= 0) {
    return bmiKeywords;
  }

  const bmi = weightKg / (heightMeters * heightMeters);
  if (!Number.isFinite(bmi)) {
    return bmiKeywords;
  }

  const rounded = Math.round(bmi);
  bmiKeywords.add(`bmi_${rounded}`);

  if (bmi < 18.5) {
    bmiKeywords.add('поднормено тегло');
    bmiKeywords.add('underweight');
  } else if (bmi < 25) {
    bmiKeywords.add('нормално тегло');
    bmiKeywords.add('healthy_weight');
  } else if (bmi < 30) {
    bmiKeywords.add('наднормено тегло');
    bmiKeywords.add('overweight');
    bmiKeywords.add('weight_management');
  } else {
    bmiKeywords.add('затлъстяване');
    bmiKeywords.add('obesity');
    bmiKeywords.add('weight_management');
  }

  if (bmi >= 27) {
    bmiKeywords.add('metabolic_risk');
  }

  return bmiKeywords;
}

function deriveGenderKeyword(rawGender) {
  if (!rawGender || typeof rawGender !== 'string') return undefined;
  const normalized = rawGender.trim().toLowerCase();
  if (!normalized) return undefined;

  if (/^(f|ж|female|жен)/.test(normalized)) {
    return 'женски клиент';
  }
  if (/^(m|м|male|мъж)/.test(normalized)) {
    return 'мъжки клиент';
  }
  return undefined;
}

function enhanceWithSynonyms(set, text) {
  const normalized = text.toLowerCase();
  if (/(контрол|управление|редукц|намаляване).*(тегло|килог|weight)|weight\s*management/.test(normalized)) {
    set.add('weight_management');
  }

  if (/анти.?ейдж|anti.?aging|подмлад/.test(normalized)) {
    set.add('anti_aging_goal');
  }

  if (/възстанов|recovery|регенерац/.test(normalized)) {
    set.add('recovery_focus');
  }

  if (/детокс|пречиств/.test(normalized)) {
    set.add('detox_focus');
  }
}

function selectRelevantInterpretationKnowledge(knowledge, keywords) {
  const ALWAYS_INCLUDE_KEYS = ['scientific_validation_summary', 'analysis_flow', 'elimination_channels'];
  const filteredKnowledge = {};
  const matchedRemedyLinks = new Set();

  if (!knowledge || typeof knowledge !== 'object') {
    return { filteredKnowledge, matchedRemedyLinks };
  }

  for (const [key, value] of Object.entries(knowledge)) {
    if (ALWAYS_INCLUDE_KEYS.includes(key)) {
      filteredKnowledge[key] = value;
      continue;
    }

    const { included, filteredValue, remedyLinks } = filterKnowledgeValue(value, keywords);
    if (included) {
      filteredKnowledge[key] = filteredValue;
      remedyLinks.forEach(link => matchedRemedyLinks.add(link));
    }
  }

  if (!Object.keys(filteredKnowledge).length) {
    filteredKnowledge.summary = 'Няма директно открити секции в базата; използвай експертна преценка за интерпретация.';
  }

  return { filteredKnowledge, matchedRemedyLinks };
}

function filterKnowledgeValue(value, keywords) {
  const remedyLinks = new Set();

  if (value == null) {
    return { included: false, filteredValue: value, remedyLinks };
  }

  if (typeof value === 'string') {
    return { included: matchesKeywords(value, keywords), filteredValue: value, remedyLinks };
  }

  if (Array.isArray(value)) {
    const filteredArray = [];
    for (const item of value) {
      const result = filterKnowledgeValue(item, keywords);
      if (result.included) {
        filteredArray.push(result.filteredValue);
        result.remedyLinks.forEach(link => remedyLinks.add(link));
      }
    }
    return { included: filteredArray.length > 0, filteredValue: filteredArray, remedyLinks };
  }

  if (typeof value === 'object') {
    const result = {};
    let included = false;
    const ownRemedyLinks = [];

    for (const [key, child] of Object.entries(value)) {
      if (key === 'remedy_link' && typeof child === 'string') {
        const slug = slugify(child);
        if (keywords.has(slug) || keywords.has(child.toLowerCase())) {
          included = true;
        }
        ownRemedyLinks.push(child);
        result[key] = child;
        continue;
      }

      const childResult = filterKnowledgeValue(child, keywords);
      if (childResult.included) {
        result[key] = childResult.filteredValue;
        included = true;
        childResult.remedyLinks.forEach(link => remedyLinks.add(link));
      } else if (typeof child === 'string' && matchesKeywords(child, keywords)) {
        result[key] = child;
        included = true;
      }
    }

    const descriptiveKeys = ['name', 'title', 'summary', 'description'];
    for (const key of descriptiveKeys) {
      if (value[key] && matchesKeywords(String(value[key]), keywords)) {
        result[key] = value[key];
        included = true;
      }
    }

    if (included) {
      ownRemedyLinks.forEach(link => remedyLinks.add(link));
      const filteredObject = { ...result };
      for (const key of ['name', 'title', 'summary', 'description']) {
        if (value[key] !== undefined && filteredObject[key] === undefined) {
          filteredObject[key] = value[key];
        }
      }
      return { included: true, filteredValue: filteredObject, remedyLinks };
    }

    return { included: false, filteredValue: result, remedyLinks };
  }

  return { included: false, filteredValue: value, remedyLinks };
}

function selectRelevantRemedyBase(remedyBase, remedyLinks, keywords) {
  const ALWAYS_INCLUDE_KEYS = ['foundational_principles'];
  const filteredBase = {};
  if (!remedyBase || typeof remedyBase !== 'object') {
    return filteredBase;
  }

  const normalizedLinks = new Set(Array.from(remedyLinks || []).map(slugify));

  for (const [key, value] of Object.entries(remedyBase)) {
    if (key === 'mandatory_disclaimer') {
      continue;
    }

    if (ALWAYS_INCLUDE_KEYS.includes(key)) {
      filteredBase[key] = value;
      continue;
    }

    const { included, filteredValue } = filterRemedyValue(key, value, normalizedLinks, keywords);
    if (included) {
      filteredBase[key] = filteredValue;
    }
  }

  if (remedyBase.mandatory_disclaimer) {
    filteredBase.mandatory_disclaimer = remedyBase.mandatory_disclaimer;
  }

  if (!Object.keys(filteredBase).length) {
    filteredBase.summary = 'Няма директно съвпадащи препоръки; използвай професионална преценка.';
  }

  return filteredBase;
}

function filterRemedyValue(keyName, value, normalizedLinks, keywords) {
  if (value == null) {
    return { included: false, filteredValue: value };
  }

  const keySlug = slugify(keyName);
  if (keySlug && normalizedLinks.has(keySlug)) {
    return { included: true, filteredValue: value };
  }

  if (typeof value === 'string') {
    return { included: matchesKeywords(value, keywords), filteredValue: value };
  }

  if (Array.isArray(value)) {
    const filteredArray = [];
    for (const item of value) {
      const result = filterRemedyValue('', item, normalizedLinks, keywords);
      if (result.included) {
        filteredArray.push(result.filteredValue);
      }
    }
    return { included: filteredArray.length > 0, filteredValue: filteredArray };
  }

  if (typeof value === 'object') {
    const descriptor = value.id || value.key || value.remedy_link || value.name || value.title;
    const descriptorSlug = typeof descriptor === 'string' ? slugify(descriptor) : '';
    if (descriptorSlug && normalizedLinks.has(descriptorSlug)) {
      return { included: true, filteredValue: value };
    }

    const result = {};
    let included = false;

    for (const [childKey, childValue] of Object.entries(value)) {
      const childResult = filterRemedyValue(childKey, childValue, normalizedLinks, keywords);
      if (childResult.included) {
        result[childKey] = childResult.filteredValue;
        included = true;
      }
    }

    if (!included) {
      const descriptiveKeys = ['name', 'title', 'description', 'details', 'application', 'summary', 'context'];
      for (const key of descriptiveKeys) {
        if (typeof value[key] === 'string' && matchesKeywords(value[key], keywords)) {
          result[key] = value[key];
          included = true;
        }
      }
    }

    if (included) {
      const filteredObject = { ...result };
      for (const key of ['name', 'title', 'description', 'details', 'application', 'summary', 'context']) {
        if (value[key] !== undefined && filteredObject[key] === undefined) {
          filteredObject[key] = value[key];
        }
      }
      return { included: true, filteredValue: filteredObject };
    }

    return { included: false, filteredValue: result };
  }

  return { included: false, filteredValue: value };
}

function matchesKeywords(text, keywords) {
  if (!text || !keywords || !keywords.size) return false;
  const normalized = text.toLowerCase();
  for (const keyword of keywords) {
    if (!keyword) continue;
    if (normalized.includes(keyword)) {
      return true;
    }
  }
  return false;
}

function slugify(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9а-я]+/giu, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// --- Други помощни функции (без промяна) ---

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

export const __testables__ = {
  generateHolisticReport,
  buildKeywordSet,
  selectRelevantInterpretationKnowledge,
  selectRelevantRemedyBase
};
