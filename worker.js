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

const MAX_FILE_SIZE_MB = 20; // Максимален размер на файловете в MB
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024; // В байтове

// CORS хедъри - конфигурирани чрез environment variable
function getCorsHeaders(env) {
  const allowedOrigin = env?.ALLOWED_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

class AiRefusalError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'AiRefusalError';
    this.reason = reason;
  }
}

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

class ConfigurationError extends Error {
  constructor(message, missingConfig) {
    super(message);
    this.name = 'ConfigurationError';
    this.missingConfig = missingConfig;
  }
}

class RateLimitError extends Error {
  constructor(message, retryAfter) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

// --- Type Definitions ---

/**
 * @typedef {Object} IrisSign
 * @property {string} [sign_name] - Име на знака
 * @property {string} [location] - Локация на знака
 * @property {string} [intensity] - Интензитет на знака
 * @property {string} [description] - Описание на знака
 * @property {string} [sign_type] - Тип на знака
 * @property {string} [remedy_link] - Линк към препоръка
 * @property {string} [scientific_source] - Научен източник
 * @property {string} [map_interpretation] - Интерпретация от картата
 * @property {number} [validated_zone] - Валидирана зона (1-7)
 * @property {string} [zone_name] - Име на зоната
 * @property {string} [zone_description] - Описание на зоната
 * @property {string} [priority_level] - Ниво на приоритет (high/medium/low)
 */

// --- Помощна функция за retry с експоненциално backoff ---

/**
 * Извършва retry на асинхронна операция при rate limit или мрежови грешки
 * @param {Function} fn - Асинхронна функция която да се извика
 * @param {number} maxRetries - Максимален брой опити (по подразбиране 3)
 * @param {number} baseDelay - Базово забавяне в ms (по подразбиране 1000)
 * @returns {Promise} Резултат от функцията
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Не правим retry при validation или configuration грешки
      if (error.name === 'ValidationError' || error.name === 'ConfigurationError' || error.name === 'AiRefusalError') {
        throw error;
      }

      // При rate limit грешка, използваме retry-after ако е наличен
      if (error.name === 'RateLimitError' && attempt < maxRetries) {
        const delay = error.retryAfter || (baseDelay * Math.pow(2, attempt));
        console.log(`Rate limit достигнат. Изчакваме ${delay}ms преди опит ${attempt + 2}/${maxRetries + 1}...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // При други грешки, използваме експоненциално backoff
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`Опит ${attempt + 1} неуспешен. Изчакваме ${delay}ms преди следващ опит...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // Последният опит също се провали
      throw error;
    }
  }

  throw lastError;
}

// --- Основен Handler на Worker-а ---

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = getCorsHeaders(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname.startsWith('/admin/')) {
      return handleAdminRequest(request, env, corsHeaders);
    }

    if (request.method === 'POST' && url.pathname === '/') {
      try {
        return await handlePostRequest(request, env, corsHeaders);
      } catch (error) {
        console.error('Критична грешка в worker-а:', error);
        return new Response(JSON.stringify({ error: 'Вътрешна грешка на сървъра: ' + error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response(JSON.stringify({ error: `Методът ${request.method} за път ${url.pathname} не е разрешен.` }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
};

// --- Логика за обработка на АДМИН заявки (без промяна) ---

async function handleAdminRequest(request, env, corsHeaders = {}) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;

  if (pathname.endsWith('/admin/models')) {
    if (method === 'GET') {
      try {
        const modelsListJson = await env.iris_rag_kv.get('iris_models_list') || '{}';
        const models = JSON.parse(modelsListJson);
        return new Response(JSON.stringify({ models }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Невалиден JSON в `iris_models_list`: ' + err.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    if (method === 'PUT') {
      try {
        const newModelsList = await request.json();
        await env.iris_rag_kv.put('iris_models_list', JSON.stringify(newModelsList));
        return new Response(JSON.stringify({ success: true }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Грешка при запис на списъка с модели: ' + err.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }
  }

  const { CF_ACCOUNT_ID, CF_API_TOKEN, CF_KV_NAMESPACE_ID } = env;
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !CF_KV_NAMESPACE_ID) {
    return new Response(JSON.stringify({ error: 'Cloudflare API credentials не са конфигурирани.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const key = url.searchParams.get('key');
  const cfApiBase = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}`;
  const cfHeaders = { 'Authorization': `Bearer ${CF_API_TOKEN}` };

  let apiUrl;
  const cfMethod = request.method;
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
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const response = await fetch(apiUrl, { method: cfMethod, headers: cfHeaders, body });
    if (!response.ok) {
      const errorText = await response.text();
      return new Response(JSON.stringify({ error: `Грешка от Cloudflare API: ${errorText}` }), {
        status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (pathname.endsWith('/keys')) {
      const data = await response.json();
      return new Response(JSON.stringify({ keys: data.result }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    if (pathname.endsWith('/get')) {
      const value = await response.text();
      return new Response(JSON.stringify({ value: value }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    if (pathname.endsWith('/put') || pathname.endsWith('/set')) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    return new Response(await response.text(), { status: response.status, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Вътрешна грешка в worker-а: ' + err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// --- Логика за обработка на POST заявка (AI Анализ) ---

async function handlePostRequest(request, env, corsHeaders = {}) {
  const formData = await request.formData();
  const leftEyeFile = formData.get('left-eye-upload');
  const rightEyeFile = formData.get('right-eye-upload');

  if (!leftEyeFile || !rightEyeFile || !(leftEyeFile instanceof File) || !(rightEyeFile instanceof File)) {
    return new Response(JSON.stringify({ error: 'Моля, качете снимки и на двете очи.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Валидация на размера на файловете
  if (leftEyeFile.size > MAX_FILE_SIZE || rightEyeFile.size > MAX_FILE_SIZE) {
    return new Response(JSON.stringify({ error: `Файловете трябва да са под ${MAX_FILE_SIZE_MB}MB.` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  /** @type {Record<string, unknown>} */
  const userData = {};
  for (const [key, value] of formData.entries()) {
    if (key === 'external-insights' || key === 'externalInsights') {
      continue;
    }

    if (typeof value !== 'string') continue;

    const existingValue = userData[key];

    if (Array.isArray(existingValue)) {
      existingValue.push(value);
      continue;
    }

    if (existingValue !== undefined) {
      userData[key] = [existingValue, value];
      continue;
    }

    userData[key] = value;
  }

  const kvKeys = ['iris_config_kv', 'iris_diagnostic_map', 'holistic_interpretation_knowledge', 'remedy_and_recommendation_base'];
  const kvPromises = kvKeys.map(key => env.iris_rag_kv.get(key, { type: 'json' }));
  const [config, irisMap, interpretationKnowledge, remedyBase] = await Promise.all(kvPromises);

  if (!config) {
    return new Response(JSON.stringify({ error: 'Липсва конфигурация на AI асистента (iris_config_kv).' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const analysisModel = typeof config.analysis_model === 'string' ? config.analysis_model.trim() : '';
  const reportModel = typeof config.report_model === 'string' ? config.report_model.trim() : '';

  if (!analysisModel || !reportModel) {
    console.error('Конфигурацията на AI моделите е непълна. analysis_model или report_model липсват.');
    return new Response(JSON.stringify({ error: 'Конфигурацията на AI моделите е непълна. Моля, задайте analysis_model и report_model.' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  config.analysis_model = analysisModel;
  config.report_model = reportModel;
  if (!irisMap || !interpretationKnowledge || !remedyBase) {
    return new Response(JSON.stringify({ error: 'Не можахме да заредим базата данни за анализ.' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const apiKey = config.provider === 'gemini' ? env.GEMINI_API_KEY : (config.provider === 'openai' ? env.OPENAI_API_KEY : null);

  const preliminaryKeywordSet = buildKeywordSet([], userData);
  const { filteredKnowledge: preliminaryKnowledge } = selectRelevantInterpretationKnowledge(interpretationKnowledge, preliminaryKeywordSet);
  const maxContextEntries = Number.isInteger(config.max_context_entries) && config.max_context_entries > 0
    ? config.max_context_entries
    : 6;
  config.max_context_entries = maxContextEntries;

  // За визуалния анализ използваме обогатен контекст с ключова информация
  // за разпознаване на знаци, вместо да разчитаме само на userData keywords
  const visionContextPayload = createEnrichedVisionContext(interpretationKnowledge, maxContextEntries);

  const [leftEyeAnalysisResult, rightEyeAnalysisResult] = await Promise.all([
    retryWithBackoff(() => analyzeImageWithVision(leftEyeFile, 'ляво око', irisMap, config, apiKey, visionContextPayload)),
    retryWithBackoff(() => analyzeImageWithVision(rightEyeFile, 'дясно око', irisMap, config, apiKey, visionContextPayload))
  ]);

  const finalReport = await retryWithBackoff(() => generateHolisticReport(
    userData, leftEyeAnalysisResult, rightEyeAnalysisResult,
    interpretationKnowledge, remedyBase, config, apiKey, env, irisMap
  ));

  return new Response(JSON.stringify(finalReport), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// --- Помощни функции за комуникация с AI ---

/**
 * *** КЛЮЧОВА ПРОМЯНА ***
 * Тази функция е напълно преработена, за да поддържа както Gemini, така и OpenAI за визуален анализ.
 * Вече няма да пропуска анализа на снимките, ако е избран OpenAI.
 */
async function analyzeImageWithVision(file, eyeIdentifier, irisMap, config, apiKey, externalContextPayload = '[]') {
  const template = typeof config.analysis_prompt_template === 'string'
    ? config.analysis_prompt_template
    : '';

  // Използваме компактна версия на diagnostic map за да не претоварваме контекста
  const conciseMap = createConciseIrisMap(irisMap);

  const prompt = template
    .replace('{{EYE_IDENTIFIER}}', eyeIdentifier)
    .replace('{{IRIS_MAP}}', JSON.stringify(conciseMap, null, 2))
    .replace('{{EXTERNAL_CONTEXT}}', externalContextPayload);

  const base64Image = await arrayBufferToBase64(await file.arrayBuffer());

  if (!apiKey) throw new Error(`API ключ за доставчик '${config.provider}' не е намерен.`);

  let apiUrl, requestBody, headers;

  if (config.provider === 'gemini') {
    apiUrl = `${API_BASE_URLS.gemini}${config.analysis_model}:generateContent?key=${apiKey}`;
    headers = { 'Content-Type': 'application/json' };
    requestBody = {
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: file.type, data: base64Image } }] }],
      generationConfig: { 'response_mime_type': 'application/json' }
    };
  } else if (config.provider === 'openai') {
    if ((config.analysis_model || '').trim() === 'gpt-4o-search-preview') {
      return await runSearchPreview({
        apiKey,
        prompt,
        assistantId: config.analysis_assistant_id || config.search_preview_assistant_id,
        metadata: {
          usecase: 'analysis',
          eye: eyeIdentifier
        },
        attachments: [
          {
            type: 'image_base64',
            mimeType: file.type,
            data: base64Image,
            label: eyeIdentifier
          }
        ],
        responseFormat: { type: 'json_object' }
      });
    }
    // НОВА ЛОГИКА: Конструиране на заявка за OpenAI Vision API
    apiUrl = API_BASE_URLS.openai;
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };
    requestBody = {
      model: config.analysis_model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { 'url': `data:${file.type};base64,${base64Image}` }
          }
        ]
      }],
      max_tokens: 2048,
      response_format: { type: 'json_object' }
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

    // Обработка на 429 Rate Limit грешка
    if (response.status === 429) {
      let retryAfter = 1000; // По подразбиране 1 секунда

      try {
        const errorData = JSON.parse(errorBody);
        // Извличаме retry-after информация от отговора
        if (errorData.error?.message) {
          const match = errorData.error.message.match(/try again in (\d+\.?\d*)([ms])/i);
          if (match) {
            const value = parseFloat(match[1]);
            const unit = match[2];
            retryAfter = unit === 's' ? value * 1000 : value;
          }
        }
      } catch (e) {
        // Ако не можем да parse-нем грешката, използваме Retry-After header
        const retryAfterHeader = response.headers.get('Retry-After');
        if (retryAfterHeader) {
          retryAfter = parseInt(retryAfterHeader, 10) * 1000;
        }
      }

      throw new RateLimitError(
        `Rate limit достигнат за ${config.provider}. Моля, изчакайте ${Math.ceil(retryAfter / 1000)} секунди.`,
        retryAfter
      );
    }

    throw new Error(`Неуспешен визуален анализ на изображението с ${config.provider}.`);
  }

  const data = await response.json();
  let jsonText;

  if (config.provider === 'gemini') {
    const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : undefined;
    if (candidate?.finishReason === 'SAFETY') {
      const refusalReason = candidate?.safetyRatings?.[0]?.probability || 'Content flagged';
      console.warn('AI отказ за визуален анализ (Gemini):', {
        finishReason: candidate.finishReason,
        refusalReason
      });
      throw new AiRefusalError('AI моделът отказа да изпълни заявката.', refusalReason);
    }
    jsonText = candidate?.content?.parts?.map((part) => part?.text || '').join('\n') ?? '';
  } else if (config.provider === 'openai') {
    const choice = Array.isArray(data?.choices) ? data.choices[0] : undefined;
    if (choice?.finish_reason === 'content_filter') {
      const refusalReason = choice?.message?.refusal || 'Content filtered';
      console.warn('AI отказ за визуален анализ (OpenAI):', {
        finish_reason: choice.finish_reason,
        refusal: refusalReason
      });
      throw new AiRefusalError('AI моделът отказа да изпълни заявката.', refusalReason);
    }
    jsonText = choice?.message?.content ?? '';
  }

  jsonText = normalizeModelJsonText(jsonText).replace(/```json/g, '').replace(/```/g, '').trim();

  try {
    return JSON.parse(jsonText);
  } catch (e) {
    // Логване на пълния отговор и грешката за debugging
    console.error('Грешка при парсване на JSON от AI (визуален анализ):');
    console.error('Получен текст:', jsonText.substring(0, 500)); // Първите 500 символа
    console.error('Parse грешка:', e.message);
    throw new Error(
      'AI моделът върна невалиден JSON формат за визуалния анализ. ' +
        `Получен отговор започва с: "${jsonText.substring(0, 100)}..."`
    );
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
        'X-API-KEY': env.WEB_RESEARCH_API_KEY
      },
      body: JSON.stringify({ q: query }),
      signal: controller.signal
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
        url: item.link || item.url || ''
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

/**
 * Валидира и обогатява идентифицирани знаци с информация от diagnostic map
 * @param {IrisSign[]} identifiedSigns - Знаци идентифицирани от AI
 * @param {Object} irisMap - Iris diagnostic map от KV
 * @returns {IrisSign[]} - Валидирани и обогатени знаци
 */
function validateAndEnrichSigns(identifiedSigns, irisMap) {
  if (!Array.isArray(identifiedSigns) || !irisMap || typeof irisMap !== 'object') {
    return identifiedSigns || [];
  }

  const enrichedSigns = [];
  const allKnownSigns = collectAllSignsFromMap(irisMap);

  for (const sign of identifiedSigns) {
    if (!sign || typeof sign !== 'object') continue;

    const enrichedSign = { ...sign };
    const signName = (/** @type {IrisSign} */ (sign).sign_name || '').toLowerCase();

    // Търсене на съвпадение в diagnostic map за допълнителна информация
    let matchedMapSign = null;
    for (const [mapKey, mapSign] of Object.entries(allKnownSigns)) {
      if (!mapSign || !mapSign.name) continue;
      const mapSignName = mapSign.name.toLowerCase();

      // Проверка за директно съвпадение или частично съвпадение
      if (signName === mapSignName ||
          signName.includes(mapKey.toLowerCase()) ||
          mapSignName.includes(signName)) {
        matchedMapSign = mapSign;
        break;
      }
    }

    if (matchedMapSign) {
      // Обогатяване с информация от картата
      if (matchedMapSign.type && !enrichedSign.sign_type) {
        enrichedSign.sign_type = matchedMapSign.type;
      }
      if (matchedMapSign.remedy_link && !enrichedSign.remedy_link) {
        enrichedSign.remedy_link = matchedMapSign.remedy_link;
      }
      if (matchedMapSign.source && !enrichedSign.scientific_source) {
        enrichedSign.scientific_source = matchedMapSign.source;
      }

      // Добавяне на допълнителен контекст за интерпретация
      if (matchedMapSign.interpretation && !enrichedSign.map_interpretation) {
        enrichedSign.map_interpretation = typeof matchedMapSign.interpretation === 'string'
          ? matchedMapSign.interpretation
          : JSON.stringify(matchedMapSign.interpretation);
      }
    }

    // Валидация на зона (1-7)
    const location = (/** @type {IrisSign} */ (sign).location || '').toLowerCase();
    const zoneMatch = location.match(/зона\s*(\d+)/i);
    if (zoneMatch) {
      const zoneNum = parseInt(zoneMatch[1], 10);
      if (zoneNum >= 1 && zoneNum <= 7) {
        enrichedSign.validated_zone = zoneNum;

        // Добавяне на име на зоната от картата
        if (irisMap.topography && Array.isArray(irisMap.topography.zones)) {
          const zoneInfo = irisMap.topography.zones.find(z => z.zone === zoneNum);
          if (zoneInfo) {
            enrichedSign.zone_name = zoneInfo.name;
            enrichedSign.zone_description = zoneInfo.description;
          }
        }
      }
    }

    // Валидиране и обогатяване на интензитет
    if (/** @type {IrisSign} */ (sign).intensity) {
      const intensity = /** @type {IrisSign} */ (sign).intensity.toLowerCase();
      if (intensity.includes('силен') || intensity.includes('high') || intensity.includes('severe')) {
        enrichedSign.priority_level = 'high';
      } else if (intensity.includes('умерен') || intensity.includes('moderate')) {
        enrichedSign.priority_level = 'medium';
      } else {
        enrichedSign.priority_level = 'low';
      }
    }

    enrichedSigns.push(enrichedSign);
  }

  return enrichedSigns;
}

/**
 * Събира всички знаци от iris diagnostic map
 * @param {Object} irisMap
 * @returns {Object} - Обект със знаци
 */
function collectAllSignsFromMap(irisMap) {
  const allSigns = {};

  if (irisMap.signs && typeof irisMap.signs === 'object') {
    for (const [key, value] of Object.entries(irisMap.signs)) {
      if (value && typeof value === 'object') {
        allSigns[key] = value;

        // Ако има подтипове (напр. lacunae_types)
        if (Array.isArray(value.subtypes)) {
          for (const subtype of value.subtypes) {
            if (subtype && typeof subtype.name === 'string' && subtype.name) {
              allSigns[key + '_' + slugify(subtype.name)] = {
                ...subtype,
                parent: key
              };
            }
          }
        }
      }
    }
  }

  return allSigns;
}

/**
 * Обогатява потребителските данни с изчислени метрики за по-добра персонализация
 * @param {Record<string, unknown>} userData - Оригинални потребителски данни
 * @param {IrisSign[]} identifiedSigns - Идентифицирани знаци от двете очи
 * @returns {Record<string, unknown>} - Обогатени данни
 */
function enrichUserDataWithMetrics(userData, identifiedSigns) {
  const enriched = { ...userData };
  const numericContext = parseNumericContext(userData);

  // Добавяне на BMI ако има данни за ръст и тегло
  if (numericContext.heightCm && numericContext.weightKg) {
    const heightMeters = numericContext.heightCm / 100;
    const bmi = numericContext.weightKg / (heightMeters * heightMeters);
    enriched.calculated_bmi = Math.round(bmi * 10) / 10;

    // Интерпретация на BMI
    if (bmi < 18.5) {
      enriched.bmi_category = 'поднормено тегло';
    } else if (bmi < 25) {
      enriched.bmi_category = 'нормално тегло';
    } else if (bmi < 30) {
      enriched.bmi_category = 'наднормено тегло';
    } else {
      enriched.bmi_category = 'затлъстяване';
    }
  }

  // Добавяне на възрастова група за по-добра персонализация
  if (numericContext.ageYears) {
    if (numericContext.ageYears < 30) {
      enriched.age_group = 'млад възрастен';
    } else if (numericContext.ageYears < 45) {
      enriched.age_group = 'среден възрастен';
    } else if (numericContext.ageYears < 65) {
      enriched.age_group = 'зряла възраст';
    } else {
      enriched.age_group = 'напреднала възраст';
    }
  }

  // Оценка на общия риск според броя и интензитета на знаците
  if (identifiedSigns && Array.isArray(identifiedSigns)) {
    enriched.signs_count = identifiedSigns.length;

    // Броене на знаци с висок интензитет
    const highIntensitySigns = identifiedSigns.filter(sign =>
      sign && typeof sign === 'object' && 'intensity' in sign &&
      (sign.intensity === 'силен' || sign.intensity === 'high' || sign.intensity === 'severe')
    ).length;

    enriched.high_intensity_signs_count = highIntensitySigns;

    // Обща оценка на риска
    if (identifiedSigns.length === 0) {
      enriched.overall_risk_assessment = 'нисък риск';
    } else if (highIntensitySigns > 0 || identifiedSigns.length > 5) {
      enriched.overall_risk_assessment = 'повишен риск';
    } else {
      // 1-5 знака без високо интензитетни
      enriched.overall_risk_assessment = 'умерен риск';
    }
  }

  // Оценка на нивото на стрес
  if (numericContext.stressLevel !== undefined) {
    if (numericContext.stressLevel <= 3) {
      enriched.stress_assessment = 'ниско ниво на стрес';
    } else if (numericContext.stressLevel <= 6) {
      enriched.stress_assessment = 'умерено ниво на стрес';
    } else {
      enriched.stress_assessment = 'високо ниво на стрес';
    }
  }

  // Оценка на съня
  if (numericContext.sleepHours !== undefined) {
    if (numericContext.sleepHours < 6) {
      enriched.sleep_assessment = 'недостатъчен сън (критично)';
    } else if (numericContext.sleepHours < 7) {
      enriched.sleep_assessment = 'субоптимален сън';
    } else if (numericContext.sleepHours <= 9) {
      enriched.sleep_assessment = 'добър сън';
    } else {
      enriched.sleep_assessment = 'прекалено много сън';
    }
  }

  // Оценка на хидратацията
  if (numericContext.waterLiters !== undefined) {
    if (numericContext.waterLiters < 1.5) {
      enriched.hydration_assessment = 'недостатъчна хидратация';
    } else if (numericContext.waterLiters < 2.5) {
      enriched.hydration_assessment = 'умерена хидратация';
    } else {
      enriched.hydration_assessment = 'добра хидратация';
    }
  }

  // Анализ на типове знаци за по-добро насочване на RAG контекста
  if (identifiedSigns && Array.isArray(identifiedSigns)) {
    const signTypes = {
      lacunae: 0,
      rings: 0,
      radii: 0,
      pigments: 0,
      toxic_rings: 0,
      lymphatic: 0
    };

    const affectedZones = new Set();
    const affectedOrgans = new Set();

    for (const sign of identifiedSigns) {
      if (!sign || typeof sign !== 'object') continue;

      const signName = (/** @type {IrisSign} */ (sign).sign_name || '').toLowerCase();
      const location = (/** @type {IrisSign} */ (sign).location || '').toLowerCase();

      // Категоризиране на типове знаци
      if (signName.includes('лакун') || signName.includes('lacun')) {
        signTypes.lacunae++;
      }
      if (signName.includes('пръстен') || signName.includes('ring') || signName.includes('furrow')) {
        signTypes.rings++;
      }
      if (signName.includes('радиар') || signName.includes('radii') || signName.includes('solaris')) {
        signTypes.radii++;
      }
      if (signName.includes('пигмент') || signName.includes('pigment') || signName.includes('spot')) {
        signTypes.pigments++;
      }
      if (signName.includes('scurf') || signName.includes('sodium') || signName.includes('arcus')) {
        signTypes.toxic_rings++;
      }
      if (signName.includes('лимфн') || signName.includes('lymph') || signName.includes('розет')) {
        signTypes.lymphatic++;
      }

      // Извличане на засегнати зони
      const zoneMatch = location.match(/зона\s*(\d+)/i);
      if (zoneMatch) {
        affectedZones.add(parseInt(zoneMatch[1], 10));
      }

      // Извличане на органни проекции
      const organKeywords = [
        'черен дроб', 'liver', 'бъбрек', 'kidney', 'панкреас', 'pancreas',
        'сърце', 'heart', 'бял дроб', 'lung', 'далак', 'spleen',
        'щитовидна', 'thyroid', 'мозък', 'brain', 'черво', 'intestin'
      ];

      for (const organ of organKeywords) {
        if (location.includes(organ)) {
          affectedOrgans.add(organ);
        }
      }
    }

    enriched.iris_sign_analysis = {
      sign_types: signTypes,
      total_unique_zones_affected: affectedZones.size,
      affected_zones: Array.from(affectedZones).sort(),
      total_organs_implicated: affectedOrgans.size,
      affected_organs: Array.from(affectedOrgans)
    };

    // Приоритизиране на системи за подкрепа базирано на находките
    const systemPriorities = [];

    if (signTypes.toxic_rings > 0 || affectedZones.has(7)) {
      systemPriorities.push('detoxification_priority');
    }
    if (signTypes.lacunae > 2) {
      systemPriorities.push('organ_support_priority');
    }
    if (signTypes.rings > 3) {
      systemPriorities.push('nervous_system_priority');
    }
    if (signTypes.lymphatic > 0 || affectedZones.has(6)) {
      systemPriorities.push('lymphatic_drainage_priority');
    }
    if (affectedZones.has(1) || affectedZones.has(2)) {
      systemPriorities.push('digestive_health_priority');
    }

    enriched.iris_system_priorities = systemPriorities;
  }

  return enriched;
}

/**
 * Генерира детайлни аналитични метрики за анализа
 * @param {Object} leftEyeAnalysis - Анализ на лявото око
 * @param {Object} rightEyeAnalysis - Анализ на дясното око
 * @param {IrisSign[]} enrichedSigns - Обогатени знаци след валидация
 * @param {IrisSign[]} rawSigns - Оригинални знаци преди обогатяване
 * @param {Record<string, unknown>} userData - Потребителски данни
 * @returns {Object} - Детайлна аналитична статистика
 */
function generateAnalyticsMetrics(leftEyeAnalysis, rightEyeAnalysis, enrichedSigns, rawSigns, userData) {
  // Базови метрики
  const totalSignsDetected = enrichedSigns.length;
  const signsEnriched = enrichedSigns.filter(sign =>
    sign.validated_zone || sign.priority_level || sign.map_interpretation
  ).length;

  // Брой знаци по приоритет
  const highPrioritySigns = enrichedSigns.filter(s => s.priority_level === 'high').length;
  const mediumPrioritySigns = enrichedSigns.filter(s => s.priority_level === 'medium').length;
  const lowPrioritySigns = enrichedSigns.filter(s => s.priority_level === 'low').length;

  // Анализ на зоните
  const analyzedZones = new Set();
  enrichedSigns.forEach(sign => {
    if (sign.validated_zone) {
      analyzedZones.add(sign.validated_zone);
    }
  });

  // Конституционален анализ
  const constitutionalDepth = {
    leftEye: calculateConstitutionalDepth(leftEyeAnalysis),
    rightEye: calculateConstitutionalDepth(rightEyeAnalysis)
  };

  // Оценка на обогатяването
  const enrichmentRate = totalSignsDetected > 0
    ? Math.round((signsEnriched / totalSignsDetected) * 100)
    : 0;

  // Персонализация метрики
  const personalizationMetrics = calculatePersonalizationMetrics(userData);

  // Оценка на прецизността
  const precisionScore = calculatePrecisionScore(enrichedSigns, constitutionalDepth);

  return {
    timestamp: new Date().toISOString(),
    detection: {
      total_signs: totalSignsDetected,
      signs_enriched: signsEnriched,
      enrichment_rate: enrichmentRate,
      high_priority: highPrioritySigns,
      medium_priority: mediumPrioritySigns,
      low_priority: lowPrioritySigns
    },
    coverage: {
      zones_analyzed: analyzedZones.size,
      zones_affected: Array.from(analyzedZones).sort(),
      total_zones_available: 7,
      coverage_percentage: Math.round((analyzedZones.size / 7) * 100)
    },
    constitutional_analysis: {
      left_eye_depth: constitutionalDepth.leftEye,
      right_eye_depth: constitutionalDepth.rightEye,
      combined_depth: Math.round((constitutionalDepth.leftEye + constitutionalDepth.rightEye) / 2)
    },
    personalization: personalizationMetrics,
    quality: {
      precision_score: precisionScore,
      detail_level: precisionScore >= 85 ? 'Много висока' :
        precisionScore >= 70 ? 'Висока' :
          precisionScore >= 50 ? 'Средна' : 'Базова',
      improvement_indicators: {
        enhanced_validation: signsEnriched > 0,
        zone_mapping: analyzedZones.size >= 3,
        priority_classification: (highPrioritySigns + mediumPrioritySigns) > 0,
        personalized_metrics: personalizationMetrics.metrics_calculated > 3
      }
    }
  };
}

/**
 * Изчислява дълбочината на конституционалния анализ
 * @param {Object} eyeAnalysis - Анализ на окото
 * @returns {number} - Процент на завършеност (0-100)
 */
function calculateConstitutionalDepth(eyeAnalysis) {
  if (!eyeAnalysis || !eyeAnalysis.constitutional_analysis) return 0;

  // Константи за оценяване
  const FIELD_SCORE_FULL = 15;
  const FIELD_SCORE_PARTIAL = 5;
  const MIN_FIELD_LENGTH = 20;
  const CHANNEL_SCORE_MAX = 10;
  const CHANNEL_SCORE_PER_FILLED = 2;
  const MIN_CHANNEL_LENGTH = 10;

  const analysis = eyeAnalysis.constitutional_analysis;
  let score = 0;
  let maxScore = 0;

  const fields = [
    'level_1_constitution_color',
    'level_2_disposition_structure',
    'level_3_diathesis_overlays',
    'density_assessment',
    'pupil_characteristics',
    'anv_collarette_analysis'
  ];

  fields.forEach(field => {
    maxScore += FIELD_SCORE_FULL;
    if (analysis[field] && typeof analysis[field] === 'string' && analysis[field].length > MIN_FIELD_LENGTH) {
      score += FIELD_SCORE_FULL;
    } else if (analysis[field]) {
      score += FIELD_SCORE_PARTIAL;
    }
  });

  // Елиминативни канали
  if (eyeAnalysis.eliminative_channels_assessment) {
    maxScore += CHANNEL_SCORE_MAX;
    const channels = eyeAnalysis.eliminative_channels_assessment;
    const filledChannels = Object.values(channels).filter(
      v => v && typeof v === 'string' && v.length > MIN_CHANNEL_LENGTH
    ).length;
    score += Math.min(filledChannels * CHANNEL_SCORE_PER_FILLED, CHANNEL_SCORE_MAX);
  }

  return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
}

/**
 * Изчислява метрики за персонализация
 * @param {Record<string, unknown>} userData - Потребителски данни
 * @returns {Object} - Метрики за персонализация
 */
function calculatePersonalizationMetrics(userData) {
  const metrics = {
    metrics_calculated: 0,
    bmi_calculated: false,
    age_group_identified: false,
    risk_assessment_performed: false,
    lifestyle_factors_analyzed: 0
  };

  if (userData.calculated_bmi !== undefined) {
    metrics.metrics_calculated++;
    metrics.bmi_calculated = true;
  }

  if (userData.age_group) {
    metrics.metrics_calculated++;
    metrics.age_group_identified = true;
  }

  if (userData.overall_risk_assessment) {
    metrics.metrics_calculated++;
    metrics.risk_assessment_performed = true;
  }

  // Проверка на животен стил
  const lifestyleFactors = ['stress_assessment', 'sleep_assessment', 'hydration_assessment'];
  lifestyleFactors.forEach(factor => {
    if (userData[factor]) {
      metrics.metrics_calculated++;
      metrics.lifestyle_factors_analyzed++;
    }
  });

  return metrics;
}

/**
 * Изчислява обща оценка на прецизността
 * @param {IrisSign[]} signs - Обогатени знаци
 * @param {Object} constitutionalDepth - Дълбочина на конституционален анализ
 * @returns {number} - Оценка 0-100
 */
function calculatePrecisionScore(signs, constitutionalDepth) {
  // Константи за оценяване на знаци
  const SIGN_BASE_SCORE = 10;
  const SIGN_VALIDATED_ZONE_BONUS = 5;
  const SIGN_PRIORITY_BONUS = 5;
  const SIGN_INTERPRETATION_BONUS = 5;
  const SIGN_ZONE_NAME_BONUS = 3;
  const SIGN_INTENSITY_BONUS = 2;
  const MAX_SIGN_SCORE = SIGN_BASE_SCORE + SIGN_VALIDATED_ZONE_BONUS +
                         SIGN_PRIORITY_BONUS + SIGN_INTERPRETATION_BONUS +
                         SIGN_ZONE_NAME_BONUS + SIGN_INTENSITY_BONUS; // = 30

  // Тегла за различните компоненти на оценката
  const SIGN_QUALITY_WEIGHT = 40;
  const CONSTITUTIONAL_WEIGHT = 30;
  const COVERAGE_WEIGHT = 30;
  const MIN_SIGNS_FOR_FULL_COVERAGE = 5;

  let score = 0;

  // 40% от оценката: качество на знаците
  const signQualityScore = signs.reduce((acc, sign) => {
    let signScore = SIGN_BASE_SCORE;

    if (sign.validated_zone) signScore += SIGN_VALIDATED_ZONE_BONUS;
    if (sign.priority_level) signScore += SIGN_PRIORITY_BONUS;
    if (sign.map_interpretation) signScore += SIGN_INTERPRETATION_BONUS;
    if (sign.zone_name) signScore += SIGN_ZONE_NAME_BONUS;
    if (sign.intensity) signScore += SIGN_INTENSITY_BONUS;

    return acc + signScore;
  }, 0);

  const maxSignScore = signs.length * MAX_SIGN_SCORE;
  score += maxSignScore > 0 ? (signQualityScore / maxSignScore) * SIGN_QUALITY_WEIGHT : 0;

  // 30% от оценката: конституционален анализ
  const avgConstitutional = (constitutionalDepth.leftEye + constitutionalDepth.rightEye) / 2;
  score += (avgConstitutional / 100) * CONSTITUTIONAL_WEIGHT;

  // 30% от оценката: обхват на анализа
  const coverageBonus = signs.length >= MIN_SIGNS_FOR_FULL_COVERAGE
    ? COVERAGE_WEIGHT
    : (signs.length / MIN_SIGNS_FOR_FULL_COVERAGE) * COVERAGE_WEIGHT;
  score += coverageBonus;

  return Math.min(Math.round(score), 100);
}

/**
 * Генерира холистичен доклад базиран на анализите на двете очи
 * @param {Record<string, unknown>} userData - Данни за потребителя
 * @param {Object} leftEyeAnalysis - Анализ на лявото око
 * @param {Object} rightEyeAnalysis - Анализ на дясното око
 * @param {Object} interpretationKnowledge - База знания за интерпретация
 * @param {Object} remedyBase - База с препоръки
 * @param {Object} config - Конфигурация на AI модела
 * @param {string} apiKey - API ключ
 * @param {Object} env - Environment променливи
 * @param {Object} irisMap - Iris diagnostic map за валидация
 * @returns {Promise<Object>} - Генериран доклад
 * @note Функцията има 9 параметъра. Бъдещо подобрение: групиране в config обект
 */
async function generateHolisticReport(userData, leftEyeAnalysis, rightEyeAnalysis, interpretationKnowledge, remedyBase, config, apiKey, env, irisMap) {
  // Проверка дали е активиран multi-query режим (по подразбиране е ИЗКЛЮЧЕН за обратна съвместимост)
  const useMultiQuery = config.use_multi_query_report === true;

  if (useMultiQuery) {
    return await generateMultiQueryReport(userData, leftEyeAnalysis, rightEyeAnalysis, interpretationKnowledge, remedyBase, config, apiKey, env, irisMap);
  }

  // Стар подход - единична заявка (по подразбиране)
  return await generateSingleQueryReport(userData, leftEyeAnalysis, rightEyeAnalysis, interpretationKnowledge, remedyBase, config, apiKey, env, irisMap);
}

/**
 * Генерира доклад чрез множество фокусирани AI заявки (ново - подобрено качество)
 * @param {Record<string, unknown>} userData - Данни за потребителя
 * @param {Object} leftEyeAnalysis - Анализ на лявото око
 * @param {Object} rightEyeAnalysis - Анализ на дясното око
 * @param {Object} interpretationKnowledge - База знания за интерпретация
 * @param {Object} remedyBase - База с препоръки
 * @param {Object} config - Конфигурация на AI модела
 * @param {string} apiKey - API ключ
 * @param {Object} env - Environment променливи
 * @param {Object} irisMap - Iris diagnostic map за валидация
 * @returns {Promise<Object>} - Генериран доклад
 */
async function generateMultiQueryReport(userData, leftEyeAnalysis, rightEyeAnalysis, interpretationKnowledge, remedyBase, config, apiKey, env, irisMap) {
  const rawIdentifiedSigns = [
    ...((leftEyeAnalysis && Array.isArray(leftEyeAnalysis.identified_signs)) ? leftEyeAnalysis.identified_signs : []),
    ...((rightEyeAnalysis && Array.isArray(rightEyeAnalysis.identified_signs)) ? rightEyeAnalysis.identified_signs : [])
  ];

  const identifiedSigns = validateAndEnrichSigns(rawIdentifiedSigns, irisMap || {});

  // Обогатяване на потребителските данни с изчислени метрики за да се използват в аналитиката
  const enrichedUserData = enrichUserDataWithMetrics(userData, identifiedSigns);

  const analyticsMetrics = generateAnalyticsMetrics(
    leftEyeAnalysis,
    rightEyeAnalysis,
    identifiedSigns,
    rawIdentifiedSigns,
    enrichedUserData
  );

  const keywordSet = buildKeywordSet(identifiedSigns, enrichedUserData);
  const { filteredKnowledge, matchedRemedyLinks } = selectRelevantInterpretationKnowledge(interpretationKnowledge, keywordSet);
  const relevantRemedyBase = selectRelevantRemedyBase(remedyBase, matchedRemedyLinks, keywordSet);
  const disclaimerText = (remedyBase && remedyBase.mandatory_disclaimer && remedyBase.mandatory_disclaimer.text)
    ? remedyBase.mandatory_disclaimer.text
    : 'Важно: Този анализ е с образователна цел. Консултирайте се със специалист при здравословни въпроси.';

  // СТЪПКА 1: Конституционален анализ и синтеза
  const constitutionalAnalysis = await generateConstitutionalSynthesis(
    leftEyeAnalysis,
    rightEyeAnalysis,
    enrichedUserData,
    filteredKnowledge,
    config,
    apiKey
  );

  // СТЪПКА 2: Анализ на знаците и здравни импликации
  const signsInterpretation = await generateSignsInterpretation(
    identifiedSigns,
    constitutionalAnalysis,
    enrichedUserData,
    filteredKnowledge,
    config,
    apiKey
  );

  // СТЪПКА 3: Персонализирани препоръки
  const recommendations = await generatePersonalizedRecommendations(
    signsInterpretation,
    constitutionalAnalysis,
    enrichedUserData,
    relevantRemedyBase,
    config,
    apiKey
  );

  // СТЪПКА 4: Сглобяване на финалния доклад
  const finalReport = await assembleFinalReport(
    constitutionalAnalysis,
    signsInterpretation,
    recommendations,
    enrichedUserData,
    disclaimerText,
    config,
    apiKey
  );

  // Добавяне на информация за броя заявки
  finalReport._analytics = {
    ...analyticsMetrics,
    ai_queries: {
      image_analysis: 2,  // 2 заявки за анализ на двете очи
      report_generation: 4,  // 4 заявки в multi-query режим
      total: 6,  // Общо 6 заявки
      mode: 'multi-query'
    }
  };
  return finalReport;
}

/**
 * Стария подход - генериране на доклад с единична заявка
 * @param {Record<string, unknown>} userData - Данни за потребителя
 * @param {Object} leftEyeAnalysis - Анализ на лявото око
 * @param {Object} rightEyeAnalysis - Анализ на дясното око
 * @param {Object} interpretationKnowledge - База знания за интерпретация
 * @param {Object} remedyBase - База с препоръки
 * @param {Object} config - Конфигурация на AI модела
 * @param {string} apiKey - API ключ
 * @param {Object} env - Environment променливи
 * @param {Object} irisMap - Iris diagnostic map за валидация
 * @returns {Promise<Object>} - Генериран доклад
 */
async function generateSingleQueryReport(userData, leftEyeAnalysis, rightEyeAnalysis, interpretationKnowledge, remedyBase, config, apiKey, env, irisMap) {
  const rawIdentifiedSigns = [
    ...((leftEyeAnalysis && Array.isArray(leftEyeAnalysis.identified_signs)) ? leftEyeAnalysis.identified_signs : []),
    ...((rightEyeAnalysis && Array.isArray(rightEyeAnalysis.identified_signs)) ? rightEyeAnalysis.identified_signs : [])
  ];

  // Валидация и обогатяване на знаците с информация от diagnostic map
  const identifiedSigns = validateAndEnrichSigns(rawIdentifiedSigns, irisMap || {});

  // Обогатяване на потребителските данни с изчислени метрики за да се използват в аналитиката
  const enrichedUserData = enrichUserDataWithMetrics(userData, identifiedSigns);

  // Генериране на аналитична статистика с обогатените данни
  const analyticsMetrics = generateAnalyticsMetrics(
    leftEyeAnalysis,
    rightEyeAnalysis,
    identifiedSigns,
    rawIdentifiedSigns,
    enrichedUserData
  );

  const keywordSet = buildKeywordSet(identifiedSigns, enrichedUserData);
  const { filteredKnowledge, matchedRemedyLinks } = selectRelevantInterpretationKnowledge(interpretationKnowledge, keywordSet);
  const relevantRemedyBase = selectRelevantRemedyBase(remedyBase, matchedRemedyLinks, keywordSet);

  const keywordHints = Array.from(keywordSet);
  const webInsights = env && env.WEB_RESEARCH_API_KEY ? await fetchExternalInsights(keywordHints, env) : [];
  const normalizedWebInsights = normalizeWebSearchResults(webInsights);
  const contextLimit = Number.isInteger(config.max_context_entries) && config.max_context_entries > 0
    ? config.max_context_entries
    : 6;
  const fallbackExternalContext = buildFallbackExternalContext(
    keywordHints,
    filteredKnowledge,
    identifiedSigns,
    contextLimit
  );
  const externalContextEntries = normalizedWebInsights.length > 0
    ? normalizedWebInsights.slice(0, contextLimit)
    : fallbackExternalContext;
  const externalContextPayload = JSON.stringify(externalContextEntries, null, 2);
  const promptUserData = { ...enrichedUserData, keyword_hints: keywordHints };

  const interpretationPayload = JSON.stringify(filteredKnowledge, null, 2);
  const remedyPayload = JSON.stringify(relevantRemedyBase, null, 2);
  const disclaimerText = (remedyBase && remedyBase.mandatory_disclaimer && remedyBase.mandatory_disclaimer.text)
    ? remedyBase.mandatory_disclaimer.text
    : 'Важно: Този анализ е с образователна цел. Консултирайте се със специалист при здравословни въпроси.';

  const reportTemplate = typeof config.report_prompt_template === 'string'
    ? config.report_prompt_template
    : '';

  const prompt = reportTemplate
    .replace('{{USER_DATA}}', JSON.stringify(promptUserData, null, 2))
    .replace('{{LEFT_EYE_ANALYSIS}}', JSON.stringify(leftEyeAnalysis, null, 2))
    .replace('{{RIGHT_EYE_ANALYSIS}}', JSON.stringify(rightEyeAnalysis, null, 2))
    .replace('{{INTERPRETATION_KNOWLEDGE}}', interpretationPayload)
    .replace('{{REMEDY_BASE}}', remedyPayload)
    .replace('{{EXTERNAL_CONTEXT}}', externalContextPayload)
    .replace('{{PATIENT_NAME}}', userData.name || 'Не е посочено')
    .replace('{{DISCLAIMER}}', disclaimerText);

  if (!normalizedWebInsights.length && env && env.WEB_RESEARCH_API_KEY) {
    console.log('Външни източници не са намерени – използваме синтезиран fallback контекст.');
  }

  if (!apiKey) throw new Error(`API ключ за доставчик '${config.provider}' не е намерен.`);

  let apiUrl, requestBody, headers;

  if (config.provider === 'gemini') {
    apiUrl = `${API_BASE_URLS.gemini}${config.report_model}:generateContent?key=${apiKey}`;
    headers = { 'Content-Type': 'application/json' };
    requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { 'response_mime_type': 'application/json' }
    };
  } else if (config.provider === 'openai') {
    if ((config.report_model || '').trim() === 'gpt-4o-search-preview') {
      return await runSearchPreview({
        apiKey,
        prompt,
        assistantId: config.report_assistant_id || config.search_preview_assistant_id,
        metadata: {
          usecase: 'report',
          patient: userData?.name || 'unknown'
        },
        responseFormat: { type: 'json_object' }
      });
    }
    apiUrl = API_BASE_URLS.openai;
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };
    requestBody = {
      model: config.report_model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    };
  } else {
    throw new Error(`Доставчик '${config.provider}' не се поддържа.`);
  }

  const response = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(requestBody) });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Грешка от Text Generation API (${config.provider}): ${response.status}`, errorBody);

    // Обработка на 429 Rate Limit грешка
    if (response.status === 429) {
      let retryAfter = 1000; // По подразбиране 1 секунда

      try {
        const errorData = JSON.parse(errorBody);
        // Извличаме retry-after информация от отговора
        if (errorData.error?.message) {
          const match = errorData.error.message.match(/try again in (\d+\.?\d*)([ms])/i);
          if (match) {
            const value = parseFloat(match[1]);
            const unit = match[2];
            retryAfter = unit === 's' ? value * 1000 : value;
          }
        }
      } catch (e) {
        // Ако не можем да parse-нем грешката, използваме Retry-After header
        const retryAfterHeader = response.headers.get('Retry-After');
        if (retryAfterHeader) {
          retryAfter = parseInt(retryAfterHeader, 10) * 1000;
        }
      }

      throw new RateLimitError(
        `Rate limit достигнат за ${config.provider}. Моля, изчакайте ${Math.ceil(retryAfter / 1000)} секунди.`,
        retryAfter
      );
    }

    throw new Error('Неуспешно генериране на холистичен доклад.');
  }

  const data = await response.json();
  let jsonText;

  if (config.provider === 'gemini') {
    const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : undefined;
    jsonText = candidate?.content?.parts?.map((part) => part?.text || '').join('\n') ?? '';
  } else if (config.provider === 'openai') {
    const choice = Array.isArray(data?.choices) ? data.choices[0] : undefined;
    jsonText = choice?.message?.content ?? '';
  }

  jsonText = normalizeModelJsonText(jsonText).replace(/```json/g, '').replace(/```/g, '').trim();

  try {
    const reportData = JSON.parse(jsonText);
    // Добавяме аналитичните метрики към доклада, включително информация за заявките
    reportData._analytics = {
      ...analyticsMetrics,
      ai_queries: {
        image_analysis: 2,  // 2 заявки за анализ на двете очи
        report_generation: 1,  // 1 заявка в single-query режим
        total: 3,  // Общо 3 заявки
        mode: 'single-query'
      }
    };
    return reportData;
  } catch(e) {
    // Логване на пълния отговор и грешката за debugging
    console.error('Грешка при парсване на JSON от AI (финален доклад):');
    console.error('Получен текст:', jsonText.substring(0, 500)); // Първите 500 символа
    console.error('Parse грешка:', e.message);
    throw new Error(
      'AI моделът върна невалиден JSON формат за финалния доклад. ' +
        `Получен отговор започва с: "${jsonText.substring(0, 100)}..."`
    );
  }
}

/**
 * @param {Object} params
 * @param {string} params.apiKey
 * @param {string} params.prompt
 * @param {Array} [params.attachments]
 * @param {string} [params.assistantId]
 * @param {Object} [params.metadata]
 * @param {Object} [params.responseFormat]
 * @param {string} [params.instructions]
 */
async function runSearchPreview({
  apiKey,
  prompt,
  attachments = [],
  assistantId,
  metadata,
  responseFormat,
  instructions
}) {
  if (!apiKey) {
    throw new Error('Липсва API ключ за OpenAI Search Preview.');
  }

  const baseUrl = 'https://api.openai.com/v1';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'OpenAI-Beta': 'assistants=v2'
  };

  let effectiveAssistantId = typeof assistantId === 'string' && assistantId.trim() ? assistantId.trim() : '';

  if (!effectiveAssistantId) {
    const assistantResponse = await fetch(`${baseUrl}/assistants`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'gpt-4o-search-preview',
        tools: [{ type: 'web_search' }]
      })
    });

    if (!assistantResponse.ok) {
      const errorBody = await assistantResponse.text();
      throw new Error(`Неуспешно създаване на Assistant: ${errorBody}`);
    }

    const assistantData = await assistantResponse.json();
    effectiveAssistantId = assistantData?.id;

    if (!effectiveAssistantId) {
      throw new Error('OpenAI Assistant API не върна валидно ID.');
    }
  }

  const threadPayload = {
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildSearchPreviewMessage(prompt, attachments)
          }
        ]
      }
    ]
  };

  if (metadata && typeof metadata === 'object' && Object.keys(metadata).length > 0) {
    threadPayload.metadata = metadata;
  }

  const threadResponse = await fetch(`${baseUrl}/threads`, {
    method: 'POST',
    headers,
    body: JSON.stringify(threadPayload)
  });

  if (!threadResponse.ok) {
    const errorBody = await threadResponse.text();
    throw new Error(`Неуспешно създаване на Thread: ${errorBody}`);
  }

  const threadData = await threadResponse.json();
  const threadId = threadData?.id;

  if (!threadId) {
    throw new Error('OpenAI Assistant API не върна валидно thread ID.');
  }

  const runPayload = {
    assistant_id: effectiveAssistantId,
    web_search: { enable: true }
  };

  if (responseFormat) {
    runPayload.response_format = responseFormat;
  }

  if (instructions) {
    runPayload.instructions = instructions;
  }

  const runResponse = await fetch(`${baseUrl}/threads/${threadId}/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(runPayload)
  });

  if (!runResponse.ok) {
    const errorBody = await runResponse.text();
    throw new Error(`Неуспешно стартиране на Run: ${errorBody}`);
  }

  const runData = await runResponse.json();
  const runId = runData?.id;

  if (!runId) {
    throw new Error('OpenAI Assistant API не върна валидно run ID.');
  }

  const completedRun = await pollAssistantRun({ baseUrl, threadId, runId, headers });

  const messagesResponse = await fetch(`${baseUrl}/threads/${threadId}/messages?limit=20`, {
    method: 'GET',
    headers
  });

  if (!messagesResponse.ok) {
    const errorBody = await messagesResponse.text();
    throw new Error(`Неуспешно извличане на съобщения: ${errorBody}`);
  }

  const messagesData = await messagesResponse.json();
  const assistantMessage = Array.isArray(messagesData?.data)
    ? messagesData.data.find((message) => message && message.role === 'assistant' && message.run_id === completedRun.id)
      || messagesData.data.find((message) => message && message.role === 'assistant')
    : null;

  const assistantText = extractAssistantMessageText(assistantMessage);
  const normalized = normalizeModelJsonText(assistantText).replace(/```json/g, '').replace(/```/g, '').trim();

  try {
    return JSON.parse(normalized);
  } catch (error) {
    console.error('Невалиден JSON от gpt-4o-search-preview:', normalized);
    throw new Error('Асистентът не върна валидно JSON съдържание.');
  }
}

async function pollAssistantRun({ baseUrl, threadId, runId, headers, intervalMs = 1000, timeoutMs = 45000 }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const runStatusResponse = await fetch(`${baseUrl}/threads/${threadId}/runs/${runId}`, {
      method: 'GET',
      headers
    });

    if (!runStatusResponse.ok) {
      const errorBody = await runStatusResponse.text();
      throw new Error(`Грешка при проверка на Run: ${errorBody}`);
    }

    const statusData = await runStatusResponse.json();
    const status = statusData?.status;

    if (status === 'completed') {
      return statusData;
    }

    if (status === 'failed' || status === 'cancelled' || status === 'expired') {
      const reason = statusData?.last_error?.message || `Run приключи със статус ${status}`;
      throw new Error(reason);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('Асистентът не завърши навреме.');
}

function buildSearchPreviewMessage(prompt, attachments) {
  const parts = [prompt || ''];

  if (Array.isArray(attachments)) {
    for (const attachment of attachments) {
      if (!attachment || typeof attachment !== 'object') continue;
      if (attachment.type === 'image_base64' && attachment.data) {
        const label = attachment.label ? ` (${attachment.label})` : '';
        const mime = attachment.mimeType || 'application/octet-stream';
        parts.push(`Изображение${label}: data:${mime};base64,${attachment.data}`);
      } else if (attachment.type === 'text' && attachment.text) {
        parts.push(String(attachment.text));
      }
    }
  }

  return parts.filter(Boolean).join('\n\n');
}

function extractAssistantMessageText(message) {
  if (!message || !Array.isArray(message.content)) {
    return '';
  }

  const fragments = [];

  for (const part of message.content) {
    if (!part) continue;
    if (typeof part.text === 'string') {
      fragments.push(part.text);
      continue;
    }

    if (part.text && typeof part.text.value === 'string') {
      fragments.push(part.text.value);
      continue;
    }

    if (typeof part.value === 'string') {
      fragments.push(part.value);
      continue;
    }

    if (part.type === 'output_text' && part.output_text && typeof part.output_text === 'string') {
      fragments.push(part.output_text);
      continue;
    }

    if (part.type === 'output_text' && part.text && typeof part.text === 'object' && typeof part.text.value === 'string') {
      fragments.push(part.text.value);
    }
  }

  return fragments.join('\n');
}

function extractRagContextSummaries(knowledge, limit = Number.POSITIVE_INFINITY) {
  if (!knowledge || typeof knowledge !== 'object') {
    return [];
  }

  const contexts = [];
  const maxEntries = Number.isInteger(limit) && limit > 0 ? limit : Number.POSITIVE_INFINITY;
  for (const [key, value] of Object.entries(knowledge)) {
    if (value == null) continue;

    let summary;
    if (typeof value === 'string') {
      summary = value;
    } else {
      try {
        summary = JSON.stringify(value);
      } catch (error) {
        console.warn('Неуспешно сериализиране на RAG контекст за ключ', key, error);
        summary = String(value);
      }
    }

    if (!summary) continue;

    const normalizedSummary = summary.length > 400 ? `${summary.slice(0, 397)}...` : summary;
    contexts.push({ source: key, summary: normalizedSummary });
    if (contexts.length >= maxEntries) {
      break;
    }
  }

  return contexts;
}

function buildFallbackExternalContext(keywordHints, interpretationKnowledge, identifiedSigns, limit = 6) {
  const effectiveLimit = Number.isInteger(limit) && limit > 0 ? limit : 6;
  const fallbackEntries = [];
  const ragSummaries = extractRagContextSummaries(interpretationKnowledge, effectiveLimit);

  for (const entry of ragSummaries) {
    fallbackEntries.push({
      source: `Интерпретация (${entry.source})`,
      summary: entry.summary
    });
    if (fallbackEntries.length >= effectiveLimit) {
      return fallbackEntries;
    }
  }

  const signNames = Array.isArray(identifiedSigns)
    ? identifiedSigns
      .map((sign) => (sign && typeof sign === 'object' && typeof sign.sign_name === 'string' ? sign.sign_name.trim() : ''))
      .filter(Boolean)
      .slice(0, 3)
    : [];

  const summarySegments = [];

  if (signNames.length) {
    summarySegments.push(`Засечени знаци: ${signNames.join(', ')}`);
  }

  if (Array.isArray(keywordHints) && keywordHints.length) {
    summarySegments.push(`Ключови индикатори: ${keywordHints.slice(0, 6).join(', ')}`);
  }

  if (!summarySegments.length && ragSummaries.length) {
    summarySegments.push(ragSummaries[0].summary);
  }

  if (!summarySegments.length) {
    summarySegments.push('Не са открити външни източници; използвай вътрешната база и експертна синтеза.');
  }

  fallbackEntries.unshift({
    source: 'LLM synthesis',
    summary: summarySegments.join(' | ')
  });

  return fallbackEntries.slice(0, effectiveLimit);
}

function parseExternalInsightsFromForm(formData) {
  if (!formData || typeof formData.getAll !== 'function') {
    return [];
  }

  const insights = [];
  const keys = ['external-insights', 'externalInsights'];

  for (const key of keys) {
    const rawValues = formData.getAll(key) || [];
    for (const raw of rawValues) {
      if (typeof raw !== 'string' || !raw.trim()) continue;

      try {
        const parsed = JSON.parse(raw);
        normalizeExternalEntry(parsed, insights);
      } catch {
        insights.push({ source: 'external', summary: raw });
      }
    }
  }

  return insights;
}

function normalizeExternalEntry(entry, bucket) {
  if (Array.isArray(entry)) {
    for (const item of entry) {
      normalizeExternalEntry(item, bucket);
    }
    return;
  }

  if (entry && typeof entry === 'object') {
    const source = typeof entry.source === 'string' && entry.source.trim() ? entry.source : 'external';
    const summaryValue = typeof entry.summary === 'string' && entry.summary.trim()
      ? entry.summary
      : (() => {
        try {
          return JSON.stringify(entry);
        } catch {
          return String(entry);
        }
      })();

    const normalized = { source, summary: summaryValue };
    if (typeof entry.url === 'string' && entry.url.trim()) {
      normalized.url = entry.url.trim();
    }

    bucket.push(normalized);
    return;
  }

  const fallbackSummary = typeof entry === 'string' ? entry : String(entry);
  bucket.push({ source: 'external', summary: fallbackSummary });
}

function normalizeWebSearchResults(results) {
  const bucket = [];

  if (!Array.isArray(results)) {
    return bucket;
  }

  for (const result of results) {
    if (!result || typeof result !== 'object') continue;

    const title = typeof result.title === 'string' ? result.title.trim() : '';
    const snippet = typeof result.snippet === 'string' ? result.snippet.trim() : '';
    const url = typeof result.url === 'string' ? result.url.trim() : '';

    const candidate = {
      source: title || url || 'Уеб търсене',
      summary: snippet || title || (url ? `Прегледай ${url} за допълнителна информация.` : 'Външният източник не предостави резюме.'),
      url: url || undefined
    };

    normalizeExternalEntry(candidate, bucket);
  }

  return bucket;
}

/**
 * @param {unknown[]} identifiedSigns
 * @param {Record<string, unknown>} [userData={}]
 */
const GOAL_KEYWORDS_MAP = {
  'main-goals': {
    'отслабване': ['weight_management'],
    'контрол на теглото': ['weight_management'],
    'регулация на теглото': ['weight_management'],
    'диабет тип 2': ['type_2_diabetes', 'glycemic_control'],
    'контрол на кръвната захар': ['glycemic_control'],
    'инсулинова резистентност': ['insulin_resistance'],
    'подобряване на метаболизма': ['metabolic_risk'],
    'анти-ейдж': ['anti_aging_goal'],
    'детокс': ['detox_focus'],
    'детоксикация': ['detox_focus']
  },
  'health-status': {
    'диабет тип 2': ['type_2_diabetes', 'glycemic_control'],
    'инсулинова резистентност': ['insulin_resistance'],
    'метаболитен синдром': ['metabolic_risk'],
    'наднормено тегло': ['weight_management'],
    'затлъстяване': ['weight_management']
  }
};

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

    for (const [field, mapping] of Object.entries(GOAL_KEYWORDS_MAP)) {
      const rawValue = stressSource[field];
      if (rawValue == null) continue;

      const valueList = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const entry of valueList) {
        if (typeof entry !== 'string') continue;
        const normalized = entry.trim().toLowerCase();
        if (!normalized) continue;

        const normalizedSlug = slugify(entry);
        const mappedSlugs =
          mapping[normalized] || (normalizedSlug ? mapping[normalizedSlug] : undefined);
        if (!mappedSlugs) continue;

        for (const slug of mappedSlugs) {
          if (slug) {
            keywords.add(slug);
          }
        }
      }
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

function parseWaterIntake(raw) {
  if (raw == null) return undefined;

  // Ако е число, просто го върни
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }

  if (typeof raw === 'string') {
    const normalized = raw.toLowerCase().trim();

    // Обработка на текстовите опции от формата
    // Използваме lookup таблица за ясна и поддържаема логика
    const waterOptions = {
      'под 1 литър': 0.75,
      'under 1 liter': 0.75,
      '1-2 литра': 1.5,
      '1-2 liters': 1.5,
      'над 2 литра': 2.5,
      'over 2 liters': 2.5,
      'above 2 liters': 2.5
    };

    // Нормализираме различните видове тирета към стандартно тире
    const normalizedDashes = normalized.replace(/–|—/g, '-');

    // Проверка за точни съвпадения
    if (waterOptions[normalizedDashes]) {
      return waterOptions[normalizedDashes];
    }

    // Ако не е една от текстовите опции, опитай да извлечеш число
    return parseFloatValue(raw);
  }

  return undefined;
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

  const water = parseWaterIntake(source.water ?? source['water-intake']);
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
      .replace(/[^0-9.-]/g, ' ');
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

    const keySlug = slugify(key);
    const slugMatched = keySlug && keywords.has(keySlug);
    const { included, filteredValue, remedyLinks } = filterKnowledgeValue(value, keywords);

    if (slugMatched) {
      filteredKnowledge[key] = included ? filteredValue : value;
      const supplementalLinks = collectRemedyLinks(value);
      supplementalLinks.forEach(link => matchedRemedyLinks.add(link));
      remedyLinks.forEach(link => matchedRemedyLinks.add(link));
      continue;
    }

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

function collectRemedyLinks(value, bucket = new Set()) {
  if (value == null) {
    return bucket;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectRemedyLinks(item, bucket);
    }
    return bucket;
  }

  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'remedy_link' && typeof child === 'string') {
        bucket.add(child);
        continue;
      }
      collectRemedyLinks(child, bucket);
    }
  }

  return bucket;
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

    const keySlug = slugify(key);
    if (keySlug && keywords.has(keySlug)) {
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
  if (keySlug && (normalizedLinks.has(keySlug) || keywords.has(keySlug))) {
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
    if (descriptorSlug && (normalizedLinks.has(descriptorSlug) || keywords.has(descriptorSlug))) {
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

function normalizeModelJsonText(raw) {
  if (raw == null) {
    return '';
  }

  if (typeof raw === 'string') {
    return raw;
  }

  if (Array.isArray(raw)) {
    return raw
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  if (typeof raw === 'object') {
    if (typeof raw.text === 'string') return raw.text;
    if (typeof raw.content === 'string') return raw.content;
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }

  return String(raw);
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

/**
 * Създава компактна версия на iris diagnostic map за визуален анализ
 * Включва само най-важната информация за да не претоварва контекста
 * @param {Object} irisMap - Пълна iris diagnostic map
 * @returns {Object} - Компактна версия с основните дефиниции
 */
function createConciseIrisMap(irisMap) {
  if (!irisMap || typeof irisMap !== 'object') {
    return {};
  }

  const concise = {};

  // Включи само основните конституционални типове (без дългите описания)
  if (irisMap.constitutions) {
    concise.constitutions = {
      color_types: {},
      structural_types: {}
    };

    if (irisMap.constitutions.color_types) {
      for (const [key, value] of Object.entries(irisMap.constitutions.color_types)) {
        if (value && typeof value === 'object') {
          concise.constitutions.color_types[key] = {
            name: value.name || '',
            predispositions: value.predispositions || ''
          };
        }
      }
    }

    if (irisMap.constitutions.structural_types) {
      for (const [key, value] of Object.entries(irisMap.constitutions.structural_types)) {
        if (value && typeof value === 'object') {
          concise.constitutions.structural_types[key] = {
            name: value.name || '',
            visual_description: value.visual_description || '',
            interpretation: value.interpretation || ''
          };
        }
      }
    }
  }

  // Включи зоните (критично за локализация)
  if (irisMap.topography && irisMap.topography.zones) {
    concise.zones = irisMap.topography.zones.map(z => ({
      zone: z.zone,
      name: z.name,
      description: z.description
    }));
  }

  // Включи само имената и основната интерпретация на знаците (не пълните детайли)
  if (irisMap.signs && typeof irisMap.signs === 'object') {
    concise.signs = {};
    for (const [key, value] of Object.entries(irisMap.signs)) {
      if (value && typeof value === 'object') {
        concise.signs[key] = {
          name: value.name || key,
          type: value.type || '',
          interpretation: typeof value.interpretation === 'string'
            ? value.interpretation.substring(0, 200) + (value.interpretation.length > 200 ? '...' : '')
            : value.interpretation
        };
      }
    }
  }

  return concise;
}

// Приоритетни ключове за vision context - включват се винаги когато са налични
const VISION_CONTEXT_PRIORITY_KEYS = [
  'elimination_channels',
  'constitutional_signs_summary',
  'common_iris_signs',
  'lacunae_types',
  'nerve_rings',
  'radii_solaris'
];

/**
 * Създава обогатен external context за визуалния анализ
 * Вместо да разчита само на userData keywords, добавя ключова информация за
 * разпознаване на знаци
 * @param {Object} interpretationKnowledge - База знания за интерпретация
 * @param {number} maxEntries - Максимален брой записи
 * @returns {string} - JSON string с enriched context
 */
function createEnrichedVisionContext(interpretationKnowledge, maxEntries = 10) {
  const contextEntries = [];

  if (interpretationKnowledge && typeof interpretationKnowledge === 'object') {
    // Първо добавяме приоритетните ключове
    for (const key of VISION_CONTEXT_PRIORITY_KEYS) {
      if (interpretationKnowledge[key]) {
        const value = interpretationKnowledge[key];
        let summary;

        if (typeof value === 'string') {
          summary = value.length > 300 ? value.substring(0, 297) + '...' : value;
        } else if (typeof value === 'object') {
          const jsonStr = JSON.stringify(value);
          summary = jsonStr.length > 300 ? jsonStr.substring(0, 297) + '...' : jsonStr;
        } else {
          summary = String(value);
        }

        contextEntries.push({
          source: `Базово знание: ${key}`,
          summary: summary
        });

        if (contextEntries.length >= maxEntries) {
          break;
        }
      }
    }

    // Ако имаме още място, добавяме допълнителна информация
    if (contextEntries.length < maxEntries) {
      const additionalKeys = Object.keys(interpretationKnowledge)
        .filter(k => !VISION_CONTEXT_PRIORITY_KEYS.includes(k))
        .slice(0, maxEntries - contextEntries.length);

      for (const key of additionalKeys) {
        const value = interpretationKnowledge[key];
        let summary;

        if (typeof value === 'string') {
          summary = value.length > 300 ? value.substring(0, 297) + '...' : value;
        } else if (typeof value === 'object') {
          const jsonStr = JSON.stringify(value);
          summary = jsonStr.length > 300 ? jsonStr.substring(0, 297) + '...' : jsonStr;
        } else {
          summary = String(value);
        }

        contextEntries.push({
          source: `Интерпретация: ${key}`,
          summary: summary
        });

        if (contextEntries.length >= maxEntries) {
          break;
        }
      }
    }
  }

  // Ако все още нямаме достатъчно контекст, добавяме общи насоки
  if (contextEntries.length === 0) {
    contextEntries.push({
      source: 'Базови насоки',
      summary: 'Фокусирай се върху конституционалния анализ (цвят, структура, плътност) и елиминативните канали (черва, бъбреци, лимфа, бели дробове, кожа). Идентифицирай всички видими знаци: лакуни, нервни пръстени, radii solaris, пигменти, токсични пръстени.'
    });
  }

  return JSON.stringify(contextEntries, null, 2);
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

// --- Функции за multi-query report generation ---

/**
 * Извършва AI заявка с даден prompt
 * @param {string} prompt - Prompt за AI модела
 * @param {Object} config - Конфигурация
 * @param {string} apiKey - API ключ
 * @param {boolean} expectJson - Дали се очаква JSON отговор
 * @returns {Promise<string|Object>} - Отговор от AI
 */
async function queryAI(prompt, config, apiKey, expectJson = true) {
  if (!apiKey) throw new Error(`API ключ за доставчик '${config.provider}' не е намерен.`);

  let apiUrl, requestBody, headers;

  if (config.provider === 'gemini') {
    apiUrl = `${API_BASE_URLS.gemini}${config.report_model}:generateContent?key=${apiKey}`;
    headers = { 'Content-Type': 'application/json' };
    requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: expectJson ? { 'response_mime_type': 'application/json' } : {}
    };
  } else if (config.provider === 'openai') {
    apiUrl = API_BASE_URLS.openai;
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };
    requestBody = {
      model: config.report_model,
      messages: [{ role: 'user', content: prompt }],
      ...(expectJson ? { response_format: { type: 'json_object' } } : {})
    };
  } else {
    throw new Error(`Доставчик '${config.provider}' не се поддържа.`);
  }

  const response = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(requestBody) });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Грешка от AI API (${config.provider}): ${response.status}`, errorBody);

    if (response.status === 429) {
      let retryAfter = 1000;
      try {
        const errorData = JSON.parse(errorBody);
        if (errorData.error?.message) {
          const match = errorData.error.message.match(/try again in (\d+\.?\d*)([ms])/i);
          if (match) {
            const value = parseFloat(match[1]);
            const unit = match[2];
            retryAfter = unit === 's' ? value * 1000 : value;
          }
        }
      } catch (e) {
        const retryAfterHeader = response.headers.get('Retry-After');
        if (retryAfterHeader) {
          retryAfter = parseInt(retryAfterHeader, 10) * 1000;
        }
      }

      throw new RateLimitError(
        `Rate limit достигнат за ${config.provider}. Моля, изчакайте ${Math.ceil(retryAfter / 1000)} секунди.`,
        retryAfter
      );
    }

    throw new Error('Неуспешна AI заявка.');
  }

  const data = await response.json();
  let responseText;

  if (config.provider === 'gemini') {
    const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : undefined;
    responseText = candidate?.content?.parts?.map((part) => part?.text || '').join('\n') ?? '';
  } else if (config.provider === 'openai') {
    const choice = Array.isArray(data?.choices) ? data.choices[0] : undefined;
    responseText = choice?.message?.content ?? '';
  }

  responseText = normalizeModelJsonText(responseText).replace(/```json/g, '').replace(/```/g, '').trim();

  if (expectJson) {
    try {
      return JSON.parse(responseText);
    } catch (e) {
      console.error('Грешка при парсване на JSON от AI:', responseText.substring(0, 500));
      throw new Error('AI моделът върна невалиден JSON формат.');
    }
  }

  return responseText;
}

/**
 * СТЪПКА 1: Генерира конституционална синтеза
 */
async function generateConstitutionalSynthesis(leftEyeAnalysis, rightEyeAnalysis, userData, knowledge, config, apiKey) {
  const prompt = `Ти си експерт по ирисова диагностика. Твоята задача е да синтезираш конституционалния анализ на двете очи.

**АНАЛИЗ НА ЛЯВОТО ОКО:**
${JSON.stringify(leftEyeAnalysis.constitutional_analysis || {}, null, 2)}

**АНАЛИЗ НА ДЯСНОТО ОКО:**
${JSON.stringify(rightEyeAnalysis.constitutional_analysis || {}, null, 2)}

**ПОТРЕБИТЕЛСКИ ДАННИ:**
Име: ${userData.name || 'Не е посочено'}
Възраст: ${userData.age || 'Не е посочена'}
Цели: ${JSON.stringify(userData['main-goals'] || [])}
Здравно състояние: ${JSON.stringify(userData['health-status'] || [])}

**РЕЛЕВАНТНА БАЗА ЗНАНИЯ:**
${JSON.stringify(knowledge, null, 2).substring(0, 3000)}

**ЗАДАЧА:**
Създай детайлна конституционална синтеза която обединява находките от двете очи. Фокусирай се върху:
1. Основен конституционален тип (цвят, структура)
2. Предразположения и слаби места
3. Психологически профил
4. Връзка с текущите оплаквания/цели на потребителя

**ИЗХОД (JSON):**
{
  "constitutional_type": "Кратко описание на типа",
  "detailed_analysis": "Детайлен параграф (150-200 думи) който интегрира находки от двете очи",
  "predispositions": ["Списък от предразположения"],
  "psychological_profile": "Кратко описание на психологическия профил",
  "connection_to_goals": "Как конституцията се свързва с целите на потребителя"
}`;

  return await retryWithBackoff(() => queryAI(prompt, config, apiKey, true));
}

/**
 * СТЪПКА 2: Генерира интерпретация на знаците
 */
async function generateSignsInterpretation(signs, constitutional, userData, knowledge, config, apiKey) {
  const prompt = `Ти си експерт по ирисова диагностика. Анализирай идентифицираните знаци в контекста на конституцията.

**КОНСТИТУЦИОНАЛНА СИНТЕЗА:**
${JSON.stringify(constitutional, null, 2)}

**ИДЕНТИФИЦИРАНИ ЗНАЦИ:**
${JSON.stringify(signs, null, 2).substring(0, 4000)}

**ПОТРЕБИТЕЛСКИ ДАННИ:**
Цели: ${JSON.stringify(userData['main-goals'] || [])}
Здравно състояние: ${JSON.stringify(userData['health-status'] || [])}
Ниво на стрес (1-10): ${userData.stress || 'Не е посочено'}
Сън (часа): ${userData.sleep || 'Не е посочено'}

**РЕЛЕВАНТНА БАЗА ЗНАНИЯ:**
${JSON.stringify(knowledge, null, 2).substring(0, 3000)}

**ЗАДАЧА:**
Интерпретирай здравните импликации на идентифицираните знаци. Фокусирай се върху:
1. Приоритетни системи за подкрепа
2. Елиминативни канали (черва, бъбреци, лимфа, бели дробове, кожа)
3. Ключови находки и техните връзки
4. Синергичен ефект между знаците

**ИЗХОД (JSON):**
{
  "priority_systems": [
    {
      "system": "Име на системата",
      "why_priority": "Защо е приоритет",
      "related_signs": ["Свързани знаци"]
    }
  ],
  "eliminative_channels": {
    "intestines": "Оценка и препоръки",
    "kidneys": "Оценка и препоръки",
    "lymphatic": "Оценка и препоръки",
    "lungs": "Оценка и препоръки",
    "skin": "Оценка и препоръки"
  },
  "key_findings": [
    {
      "finding": "Име на находката",
      "description": "Описание",
      "connections": "Връзки с други находки"
    }
  ],
  "synergistic_effect": "Как знаците работят заедно"
}`;

  return await retryWithBackoff(() => queryAI(prompt, config, apiKey, true));
}

/**
 * СТЪПКА 3: Генерира персонализирани препоръки
 */
async function generatePersonalizedRecommendations(signsInterpretation, constitutional, userData, remedyBase, config, apiKey) {
  const prompt = `Ти си холистичен здравен консултант. Създай КОНКРЕТНИ и ПРИЛАГАЕМИ препоръки базирани на анализа.

**ИНТЕРПРЕТАЦИЯ НА ЗНАЦИТЕ:**
${JSON.stringify(signsInterpretation, null, 2).substring(0, 3000)}

**КОНСТИТУЦИОНАЛНА СИНТЕЗА:**
${JSON.stringify(constitutional, null, 2)}

**ПОТРЕБИТЕЛСКИ ДАННИ:**
Име: ${userData.name || 'Не е посочено'}
Възраст: ${userData.age || 'Не е посочена'}
BMI: ${userData.calculated_bmi || 'Не е посочено'}
Цели: ${JSON.stringify(userData['main-goals'] || [])}
Ниво на стрес: ${userData.stress_assessment || userData.stress || 'Не е посочено'}
Сън: ${userData.sleep_assessment || userData.sleep || 'Не е посочено'}
Хидратация: ${userData.hydration_assessment || 'Не е посочена'}

**БАЗА С ПРЕПОРЪКИ:**
${JSON.stringify(remedyBase, null, 2).substring(0, 4000)}

**ЗАДАЧА:**
Създай детайлен план за действие с КРАТКИ, КОНКРЕТНИ препоръки (15-20 думи на изречение).

**ИЗХОД (JSON):**
{
  "action_plan": {
    "immediate": ["Действие 1", "Действие 2"],
    "short_term": ["Действие 1", "Действие 2"],
    "medium_term": ["Действие 1", "Действие 2"],
    "progress_indicators": ["Индикатор 1", "Индикатор 2"]
  },
  "nutrition": {
    "foods_to_limit": [
      {
        "food": "Име на храна",
        "reason": "Защо да се ограничи"
      }
    ],
    "foods_to_add": [
      {
        "food": "Име на храна",
        "quantity": "Количество",
        "benefit": "Ползи"
      }
    ]
  },
  "herbs_and_supplements": {
    "herbs": [
      {
        "name": "Име на билка",
        "dosage": "Дозировка",
        "purpose": "Цел"
      }
    ],
    "supplements": [
      {
        "name": "Име на добавка",
        "form": "Форма",
        "dosage": "Дозировка",
        "purpose": "Цел"
      }
    ]
  },
  "holistic_recommendations": {
    "fundamental_principles": ["Принцип 1", "Принцип 2"],
    "targeted_recommendations": ["Препоръка 1", "Препоръка 2"],
    "psychology_and_emotions": "Параграф за емоционалната връзка (100-150 думи)"
  },
  "follow_up": {
    "after_1_month": "Какво да очаквате след 1 месец",
    "after_3_months": "Какво да очаквате след 3 месеца",
    "after_6_months": "Какво да очаквате след 6 месеца",
    "what_to_monitor": ["Какво да наблюдавате"]
  }
}`;

  return await retryWithBackoff(() => queryAI(prompt, config, apiKey, true));
}

/**
 * СТЪПКА 4: Сглобява финалния доклад
 */
async function assembleFinalReport(constitutional, signsInterpretation, recommendations, userData, disclaimer, config, apiKey) {
  const prompt = `Ти си експерт редактор на холистични доклади. Създай окончателния СТРУКТУРИРАН доклад.

**КОМПОНЕНТИ:**

1. КОНСТИТУЦИОНАЛЕН АНАЛИЗ:
${JSON.stringify(constitutional, null, 2)}

2. ИНТЕРПРЕТАЦИЯ НА ЗНАЦИТЕ:
${JSON.stringify(signsInterpretation, null, 2)}

3. ПРЕПОРЪКИ:
${JSON.stringify(recommendations, null, 2)}

**ПОТРЕБИТЕЛ:**
Име: ${userData.name || 'Не е посочено'}

**ЗАДАЧА:**
Сглоби компонентите в един цялостен, лесен за четене доклад с:
- Кратко резюме (2-3 изречения)
- Ясна структура
- КРАТКИ изречения (15-20 думи)
- Фокус върху приложими действия

**ИЗХОД (JSON):**
{
  "Име": "${userData.name || 'Не е посочено'}",
  "Резюме на анализа": "2-3 изречения с най-важната находка и основна препоръка",
  "Конституционален анализ": "Текст от constitutional.detailed_analysis",
  "Анализ на елиминативните канали": "Въвод + форматиран текст от signsInterpretation.eliminative_channels",
  "Приоритетни системи за подкрепа": "Форматиран списък от signsInterpretation.priority_systems",
  "Ключови находки и тяхната връзка": "Форматиран текст от signsInterpretation.key_findings + synergistic_effect",
  "План за действие": "Форматиран текст от recommendations.action_plan",
  "Специални хранителни насоки": "Форматиран текст от recommendations.nutrition",
  "Препоръки за билки и добавки": "Форматиран текст от recommendations.herbs_and_supplements",
  "Холистични препоръки": "Форматиран текст от recommendations.holistic_recommendations",
  "Препоръки за проследяване": "Форматиран текст от recommendations.follow_up",
  "Задължителен отказ от отговорност": "${disclaimer}"
}`;

  return await retryWithBackoff(() => queryAI(prompt, config, apiKey, true));
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
  analyzeImageWithVision,
  generateHolisticReport,
  generateMultiQueryReport,
  generateSingleQueryReport,
  buildKeywordSet,
  selectRelevantInterpretationKnowledge,
  selectRelevantRemedyBase,
  runSearchPreview,
  retryWithBackoff,
  createConciseIrisMap,
  createEnrichedVisionContext,
  generateAnalyticsMetrics,
  enrichUserDataWithMetrics,
  queryAI,
  generateConstitutionalSynthesis,
  generateSignsInterpretation,
  generatePersonalizedRecommendations,
  assembleFinalReport
};
