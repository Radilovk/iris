/// <reference lib="dom" />
/// <reference lib="webworker" />
// --- ПРЕРАБОТКА НА ИЗОБРАЖЕНИЯ ---
// Обработката на изображения вече се извършва клиентски.

function validateKv(data) {
  const entries = [];
  for (const [key, value] of Object.entries(data)) {
    try {
      JSON.parse(value);
    } catch (err) {
      throw new Error(`Невалиден JSON в ${key}: ${err.message}`);
    }
    entries.push({ key, value });
  }
  return entries;
}

function groupKeys(entries) {
  const groups = {};
  for (const { key } of entries) {
    const category = key.split('_')[0];
    if (!groups[category]) groups[category] = [];
    groups[category].push(key);
  }
  return groups;
}

async function bulkUpload(entries, { accountId, namespaceId, apiToken }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(entries)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Неуспешно качване: ${text}`);
  }
}

async function fetchExistingKeys({ accountId, namespaceId, apiToken }) {
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys`;
  const keys = [];
  let cursor;
  do {
    const params = new URLSearchParams({ limit: '1000' });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`${baseUrl}?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Неуспешно извличане на ключове: ${text}`);
    }
    const data = await res.json();
    keys.push(...data.result.map(k => k.name));
    cursor = data.result_info?.cursor;
    if (data.result_info?.cursor === undefined || data.result_info?.list_complete) {
      cursor = null;
    }
  } while (cursor);
  return keys;
}

async function syncKv(entries, opts) {
  const { accountId, namespaceId, apiToken } = opts;
  const existingKeys = await fetchExistingKeys({ accountId, namespaceId, apiToken });
  const keys = entries.map(e => e.key);
  const toDelete = existingKeys.filter(k => !keys.includes(k));
  const uploadEntries = [...entries, ...toDelete.map(k => ({ key: k, delete: true }))];
  if (uploadEntries.length) {
    await bulkUpload(uploadEntries, { accountId, namespaceId, apiToken });
  }
  const groups = groupKeys(entries);
  return { updated: keys, deleted: toDelete, groups };
}

// Системен промпт по подразбиране; може да бъде заменен чрез KV ключ ROLE_PROMPT
const DEFAULT_ROLE_PROMPT = `
# РОЛЯ И ЦЕЛ
Ти си експертен AI ирисолог, наречен "Iris-Holistica AI". Работиш по научен синтез от класическа, модерна и холистична иридология. Комбинирай потребителските данни и извлечените RAG знания, за да изградиш последователен анализ.

# ИНСТРУКЦИИ
1. Отговаряй само на български език.
2. Структурирай изхода си в JSON със следните ключове:
   - "summary": кратко резюме на общото състояние;
   - "constitution": основни конституционални характеристики;
   - "dispositions": предразположения и тенденции;
   - "signs": конкретни наблюдавани знаци;
   - "recommendations": общи насоки за баланс и профилактика.
   - "holistic_analysis": пълен свободен анализ с вероятности и съвети.
3. Използвай единствено информацията от входните данни и RAG.
4. Ако липсва информация, заяви го изрично и не прави предположения. Ако липсва информация, опиши какви допълнителни данни са нужни.
5. Не поставяй медицински диагнози и не предписвай лечение; формулирай анализите като образователни насоки.
6. Всяко входно изображение е последвано от текстов JSON с метаданни (например поле "eye" със стойности "left" или "right").

# ВАЖЕН ДИСКЛЕЙМЪР
**Винаги завършвай всеки анализ с този РАЗШИРЕН текст:**
"Важно: Този анализ е базиран на принципите на ирисовата и склерологичната диагностика и има образователен характер. Той не представлява медицинска диагноза, лечение или препоръка. При здравословни проблеми се консултирайте с квалифициран медицински специалист."
`;

async function getRolePrompt(env = {}) {
    if (env.iris_rag_kv) {
        try {
            const data = await env.iris_rag_kv.get('ROLE_PROMPT', 'json');
            if (data && typeof data.prompt === 'string') {
                return data.prompt;
            }
        } catch (e) {
            console.warn('Неуспешно извличане на ROLE_PROMPT от KV:', e);
        }
    }
    return DEFAULT_ROLE_PROMPT;
}

// --- КОНФИГУРАЦИЯ ---
// Чете AI_PROVIDER от environment с подразбиране към "gemini"
export async function getAIProvider(env = {}) {
    if (env.AI_PROVIDER) return env.AI_PROVIDER;
    if (env.iris_rag_kv) {
        try {
            const val = await env.iris_rag_kv.get('AI_PROVIDER', 'json');
            if (typeof val === 'string') return val;
        } catch (e) {
            console.warn('Неуспешно извличане на AI_PROVIDER от KV:', e);
        }
    }
    return 'gemini';
}

export async function getAIModel(env = {}) {
    if (env.AI_MODEL) return env.AI_MODEL;
    if (env.iris_rag_kv) {
        try {
            const val = await env.iris_rag_kv.get('AI_MODEL', 'json');
            if (typeof val === 'string' && val.trim()) {
                return val.trim();
            }
        } catch (e) {
            console.warn('Неуспешно извличане на AI_MODEL от KV:', e);
        }
    }
    const provider = await getAIProvider(env);
    return provider === 'openai' ? 'gpt-4o' : 'gemini-1.5-pro';
}

// Гарантира присъствието на поле "holistic_analysis" в схемата
function ensureHolisticSchema(schema = {}) {
    if (!schema.properties) schema.properties = {};
    if (!schema.properties.holistic_analysis) {
        schema.properties.holistic_analysis = { type: 'string' };
    }
    if (!Array.isArray(schema.required)) schema.required = [];
    if (!schema.required.includes('holistic_analysis')) {
        schema.required.push('holistic_analysis');
    }
    return schema;
}

// Извлича динамична схема за финален анализ от ENV или KV
let analysisJsonSchemaCache;

async function getAnalysisJsonSchema(env = {}) {
    if (analysisJsonSchemaCache) return analysisJsonSchemaCache;

    analysisJsonSchemaCache = (async () => {
        let schema;
        if (env.ANALYSIS_JSON_SCHEMA) {
            try {
                schema = typeof env.ANALYSIS_JSON_SCHEMA === 'string'
                    ? JSON.parse(env.ANALYSIS_JSON_SCHEMA)
                    : env.ANALYSIS_JSON_SCHEMA;
            } catch (e) {
                console.warn('Невалидна ANALYSIS_JSON_SCHEMA в ENV:', e);
            }
        } else if (env.iris_rag_kv) {
            try {
                schema = await env.iris_rag_kv.get('ANALYSIS_JSON_SCHEMA', 'json');
            } catch (e) {
                console.warn('Неуспешно извличане на ANALYSIS_JSON_SCHEMA от KV:', e);
            }
        }
        if (!schema || typeof schema !== 'object') {
            return ANALYSIS_JSON_SCHEMA;
        }
        return { name: 'analysis', schema: ensureHolisticSchema(schema) };
    })();

    return analysisJsonSchemaCache;
}

// --- ОТЛОГВАНЕ ---
function debugLog(env = {}, ...args) {
    if (env.DEBUG === "true") {
        console.log("[DEBUG]", ...args);
    }
}

// --- RAG АЛИАСИ ---
const RAG_KEY_ALIASES = {
    SIGN_RADIAL_FURROW: 'SIGN_IRIS_RADII_SOLARIS',
    CONSTITUTION_HEMOGLOBIN: 'CONSTITUTION_COLOR_HAEMATOGENIC',
    CONSTITUTION_LYMPHATIC: 'CONSTITUTION_COLOR_LYMPHATIC',
    CONSTITUTION_MIXED_BILIARY: 'CONSTITUTION_COLOR_MIXED_BILIARY',
    CONSTITUTION_CONNECTIVE_TISSUE: 'CONSTITUTION_STRUCTURE_CONNECTIVE_TISSUE',
    DISPOSITION_NERVOUS_SYSTEM: 'DISPOSITION_NERVOUS',
    'нервна система': 'DISPOSITION_NERVOUS',
    RECOMMENDATION_BALANCED_DIET: 'RECOMMENDATION_DIETARY_BALANCE',
    'балансирано хранене': 'RECOMMENDATION_DIETARY_BALANCE',
    CONSTITUTION_WOOLLY: 'CONSTITUTION_WOOL_COVERED',
    'овча покривка': 'CONSTITUTION_WOOL_COVERED',
    SIGN_IRIS_LACUNA: 'SIGN_LACUNA',
    'лакуна': 'SIGN_LACUNA',
};

// --- ПРОМПТОВЕ ---
const IDENTIFICATION_PROMPT = `
# ЗАДАЧА: ИДЕНТИФИКАЦИЯ НА ЗНАЦИ
Ти си AI асистент, специализиран в разпознаването на ирисови знаци. Разгледай предоставените снимки на ляво и дясно око.
Твоята ЕДИНСТВЕНА задача е да идентифицираш всички значими конституционални типове, предразположения, диатези, специфични знаци,
миазми, синдроми, емоционални връзки и общи препоръки.
Резултатът трябва да бъде **ЕДИНСТВЕНО JSON масив от низове (string array)**, съдържащ съответните RAG ключове за всеки идентифициран знак.
Винаги включвай поне по един ключ от групите CONSTITUTION, DISPOSITION, SIGN, RECOMMENDATION.
Не добавяй никакви обяснения. Само JSON масив.

Пример за изход:
["CONSTITUTION_...","DISPOSITION_..."]
`;

// КОРЕКЦИЯ #1: Премахната е директната референция към "ROLE_PROMPT"
const SYNTHESIS_PROMPT_TEMPLATE = `
# ЗАДАЧА: ФИНАЛЕН СИНТЕЗ
Ти получи системни инструкции за твоята роля. Сега, анализирай предоставените данни и генерирай цялостен холистичен анализ в JSON формат, както е дефинирано в твоите инструкции.

Ето цялата информация, с която разполагаш:

--- ДАННИ ЗА ПОТРЕБИТЕЛЯ ---
{{USER_DATA}}
--- КРАЙ НА ДАННИТЕ ЗА ПОТРЕБИТЕЛЯ ---

--- RAG ДАННИ ОТ НАШАТА БАЗА ЗНАНИЯ (ИЗВЛЕЧЕНИ НА БАЗА ТВОЯ ПЪРВОНАЧАЛЕН АНАЛИЗ) ---
{{RAG_DATA}}
--- КРАЙ НА RAG ДАННИТЕ ---

Моля, използвай RAG данните като основен източник на истина за твоя анализ.
Ако RAG данните са частични, използвай общите си знания и публични източници за подсилване на анализа (цитирай ги).
Ако липсва информация, опиши какви допълнителни данни са нужни.
Освен стандартните ключове, върни и поле "holistic_analysis", което представлява свободен анализ без ограничения от RAG, но при нужда можеш да ги цитираш. Сега, генерирай финалния JSON доклад.

Пример за очакван изход:
{
  "summary": "Кратък синтез, включващ RAG и външни източници",
  "holistic_analysis": "Разширен анализ...",
  "citations": [
    { "source": "RAG", "ref": "Док1" },
    { "source": "Публичен източник", "ref": "https://example.com" }
  ]
}
`;

// --- ОСНОВЕН КОНТРОЛЕР ---
export default {
    async fetch(request, env, ctx) {
        if (request.method === "OPTIONS") {
            return handleOptions(request, env);
        }

        const url = new URL(request.url);
        if (url.pathname.startsWith('/admin')) {
            return handleAdmin(request, env);
        }
        if (request.method === "POST" && url.pathname === "/analyze") {
            return handleAnalysisRequest(request, env);
        }

        return new Response("Добре дошли в Iris-Holistica AI Backend v2.3 (Active RAG)!", {
            headers: corsHeaders(request, env, { 'Content-Type': 'text/plain; charset=utf-8' }),
        });
    },
};

async function handleAdmin(request, env) {
    if (env.ADMIN_IPS) {
        const ip = request.headers.get('CF-Connecting-IP');
        const allowed = env.ADMIN_IPS.split(',').map(i => i.trim());
        if (!ip || !allowed.includes(ip)) {
            return jsonError('Forbidden', 403, request, env);
        }
    }

    const url = new URL(request.url);
    if (url.pathname === '/admin/diff' && request.method === 'POST') {
        return adminDiff(env, request);
    }
    if (url.pathname === '/admin/sync' && request.method === 'POST') {
        return adminSync(env, request);
    }
    if (url.pathname === '/admin/keys' && request.method === 'GET') {
        return adminKeys(env, request);
    }
    if (url.pathname === '/admin/secret/gemini' && request.method === 'GET') {
        const exists = Boolean(env.gemini_api_key || env.GEMINI_API_KEY);
        return new Response(JSON.stringify({ exists }), {
            headers: corsHeaders(request, env, { 'Content-Type': 'application/json' })
        });
    }
    if (url.pathname === '/admin/secret' && request.method === 'GET') {
        const exists = Boolean(env.openai_api_key || env.OPENAI_API_KEY);
        return new Response(JSON.stringify({ exists }), {
            headers: corsHeaders(request, env, { 'Content-Type': 'application/json' })
        });
    }
    if (url.pathname === '/admin/get' && request.method === 'GET') {
        const key = url.searchParams.get('key');
        return adminGet(env, request, key);
    }
    if (url.pathname === '/admin/set' && request.method === 'PUT') {
        return adminPut(env, request);
    }
    if (url.pathname === '/admin/put' && request.method === 'PUT') {
        return adminPut(env, request);
    }
    if (url.pathname === '/admin/delete' && request.method === 'DELETE') {
        const key = url.searchParams.get('key');
        return adminDelete(env, request, key);
    }
    return jsonError('Not Found', 404, request, env);
}

async function adminDiff(env, request) {
    const required = ['CF_ACCOUNT_ID', 'CF_KV_NAMESPACE_ID', 'CF_API_TOKEN'];
    const missing = required.filter(k => !env[k]);
    if (missing.length) {
        return jsonError(`Липсват конфигурационни променливи: ${missing.join(', ')}`, 500, request, env);
    }

    let data;
    try {
        data = await request.json();
    } catch {
        return jsonError('Невалиден JSON', 400, request, env);
    }

    const files = Object.keys(data);
    const { keys } = await env.iris_rag_kv.list({ limit: 1000 });
    const existingKeys = keys.map(k => k.name);

    const added = [];
    const changed = [];

    for (const file of files) {
        const value = data[file];
        try {
            JSON.parse(value);
        } catch {
            return jsonError(`Невалиден JSON в ${file}`, 400, request, env);
        }
        if (!existingKeys.includes(file)) {
            added.push(file);
        } else {
            const current = await env.iris_rag_kv.get(file);
            if (current !== value) {
                changed.push(file);
            }
        }
    }

    const deleted = existingKeys.filter(k => !files.includes(k));

    return new Response(JSON.stringify({ added, changed, deleted }), {
        headers: corsHeaders(request, env, { 'Content-Type': 'application/json' })
    });
}

async function adminSync(env, request) {
    const required = ['CF_ACCOUNT_ID', 'CF_KV_NAMESPACE_ID', 'CF_API_TOKEN'];
    const missing = required.filter(k => !env[k]);
    if (missing.length) {
        return jsonError(`Липсват конфигурационни променливи: ${missing.join(', ')}`, 500, request, env);
    }

    let data;
    try {
        data = await request.json();
    } catch {
        return jsonError("Невалиден JSON", 400, request, env);
    }

    let entries;
    try {
        entries = validateKv(data);
    } catch (err) {
        return jsonError(err.message, 400, request, env);
    }

    try {
        const result = await syncKv(entries, {
            accountId: env.CF_ACCOUNT_ID,
            namespaceId: env.CF_KV_NAMESPACE_ID,
            apiToken: env.CF_API_TOKEN
        });
        return new Response(JSON.stringify(result), {
            headers: corsHeaders(request, env, { 'Content-Type': 'application/json' })
        });
    } catch (err) {
        return jsonError(err.message, 500, request, env);
    }
}

async function adminKeys(env, request) {
    try {
        const { keys } = await env.iris_rag_kv.list({ limit: 1000 });
        return new Response(JSON.stringify({ keys: keys.map(k => k.name) }), {
            headers: corsHeaders(request, env, { 'Content-Type': 'application/json' })
        });
    } catch (err) {
        return jsonError(err.message, 500, request, env);
    }
}

async function adminGet(env, request, key) {
    if (!key) {
        return jsonError('Missing key parameter', 400, request, env);
    }
    try {
        let value = await env.iris_rag_kv.get(key);
        let warning;

        if (value === null || value === '') {
            if (key === 'lastAnalysis') {
                value = '{}';
                warning = 'missing';
            } else if (key === 'holistic_analysis') {
                value = '';
                warning = 'missing';
            } else {
                return jsonError('Not Found', 404, request, env);
            }
        } else if (key === 'lastAnalysis') {
            try {
                JSON.parse(value);
            } catch {
                value = '{}';
                warning = 'invalid';
            }
        }

        const body = warning ? { key, value, warning } : { key, value };
        return new Response(JSON.stringify(body), {
            headers: corsHeaders(request, env, { 'Content-Type': 'application/json' })
        });
    } catch (err) {
        return jsonError(err.message, 500, request, env);
    }
}

async function adminPut(env, request) {
    try {
        const { key, value } = await request.json();
        if (!key || typeof value === 'undefined') {
            return jsonError('Missing key or value', 400, request, env);
        }
        try {
            JSON.parse(value);
        } catch (err) {
            return jsonError('Невалиден JSON', 400, request, env);
        }
        const exists = await env.iris_rag_kv.get(key);
        await env.iris_rag_kv.put(key, value);
        return new Response(JSON.stringify({ ok: true, created: !exists }), {
            headers: corsHeaders(request, env, { 'Content-Type': 'application/json' })
        });
    } catch (err) {
        return jsonError(err.message, 500, request, env);
    }
}

async function adminDelete(env, request, key) {
    if (!key) {
        return jsonError('Missing key parameter', 400, request, env);
    }
    try {
        await env.iris_rag_kv.delete(key);
        return new Response(JSON.stringify({ deleted: key }), {
            headers: corsHeaders(request, env, { 'Content-Type': 'application/json' })
        });
    } catch (err) {
        return jsonError(err.message, 500, request, env);
    }
}


// --- ОРКЕСТРАТОР НА АНАЛИЗА ---

// JSON схеми за форматиране на отговорите
const RAG_KEYS_JSON_SCHEMA = {
    name: 'rag_keys',
    schema: {
        type: 'object',
        properties: {
            rag_keys: {
                type: 'array',
                items: { type: 'string' },
                minItems: 1,
                additionalItems: false
            }
        },
        required: ['rag_keys'],
        additionalProperties: false
    }
};

const ANALYSIS_JSON_SCHEMA = {
    name: 'analysis',
    schema: {
        type: 'object',
        properties: {
            holistic_analysis: { type: 'string' }
        },
        required: ['holistic_analysis'],
        additionalProperties: true
    }
};

// Извлича първия JSON масив от низ, напр.: text -> "[\"a\",\"b\"]"
function extractJsonArray(text = "") {
    let depth = 0;
    let start = -1;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === "[") {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === "]") {
            depth--;
            if (depth === 0 && start !== -1) {
                const candidate = text.slice(start, i + 1);
                try {
                    JSON.parse(candidate);
                    return candidate;
                } catch {}
            }
        }
    }
    return null;
}

async function handleAnalysisRequest(request, env) {
    const log = (...args) => debugLog(env, ...args);
    const provider = await getAIProvider(env);
    const model = await getAIModel(env);
    try {
        log("Получена е нова заявка за анализ.");
        if (provider === "gemini" && !(env.gemini_api_key || env.GEMINI_API_KEY)) {
            const msg = 'Gemini API ключът липсва';
            log(msg);
            console.info(msg);
            return jsonError(msg, 400, request, env);
        }
        if (provider === "openai" && !(env.openai_api_key || env.OPENAI_API_KEY)) {
            const msg = 'OpenAI API ключът липсва';
            log(msg);
            console.info(msg);
            return jsonError(msg, 400, request, env);
        }
        const formData = await request.formData();

        const leftEyeFile = formData.get("left-eye");
        const rightEyeFile = formData.get("right-eye");
        if (!leftEyeFile && !rightEyeFile) {
            const msg = 'Не е подадено изображение.';
            log(msg);
            console.info(msg);
            return jsonError(msg, 400, request, env);
        }

        if (leftEyeFile && !leftEyeFile.type.startsWith('image/')) {
            const msg = 'Левият файл не е изображение.';
            log(msg);
            console.info(msg);
            return jsonError(msg, 400, request, env);
        }
        if (rightEyeFile && !rightEyeFile.type.startsWith('image/')) {
            const msg = 'Десният файл не е изображение.';
            log(msg);
            console.info(msg);
            return jsonError(msg, 400, request, env);
        }
        
        const digestion = formData.getAll("digestion") || [];
        const digestionOther = formData.get("digestion-other");
        if (digestionOther) digestion.push(digestionOther);

        const gender = formData.get("gender");
        const userData = {
            name: formData.get("name"),
            age: formData.get("age"),
            height: formData.get("height"),
            weight: formData.get("weight"),
            gender,
            mainComplaint: formData.get("main-complaint"),
            surgeries: formData.get("surgeries"),
            familyHistory: formData.get("family-history"),
            water: formData.get("water"),
            sleep: formData.get("sleep"),
            stress: formData.get("stress"),
            digestive: digestion,
        };
        if (gender !== "Мъж" && gender !== "Жена") userData.gender = "";
        const leftEyeUrl = leftEyeFile ? await uploadImageAndGetUrl(leftEyeFile, env) : null;
        const rightEyeUrl = rightEyeFile ? await uploadImageAndGetUrl(rightEyeFile, env) : null;
        const leftEyeImage = !leftEyeUrl && leftEyeFile ? await fileToBase64(leftEyeFile, env) : null;
        const rightEyeImage = !rightEyeUrl && rightEyeFile ? await fileToBase64(rightEyeFile, env) : null;
        log("Данните от формуляра са обработени успешно.");

        log("Стъпка 1: Изпращане на заявка за идентификация на знаци...");
        const identificationApiCaller = provider === "gemini" ? callGeminiAPI : callOpenAIAPI;
        const keysResponse = await identificationApiCaller(
            model,
            IDENTIFICATION_PROMPT,
            { jsonSchema: RAG_KEYS_JSON_SCHEMA },
            leftEyeImage,
            rightEyeImage,
            env,
            true,
            leftEyeUrl,
            rightEyeUrl
        );
        
        let ragKeys;
        const cleaned = extractJsonArray(keysResponse) || keysResponse;
        try {
            ragKeys = JSON.parse(cleaned);
            if (ragKeys && typeof ragKeys === 'object' && 'error' in ragKeys) {
                const msg = ragKeys.error;
                log('AI върна грешка:', msg);
                console.info('AI върна грешка:', msg);
                return jsonError(msg, 400, request, env);
            }
        } catch (parseError) {
            const logMsg = "Суров отговор от AI при грешка в парсването:";
            log(logMsg, keysResponse);
            console.info(logMsg, keysResponse);
            return jsonError('AI върна невалиден формат. Очакван JSON масив, напр.: ["нервна система","панкреас"]', 400, request, env);
        }
        if (!Array.isArray(ragKeys) || !ragKeys.every(k => typeof k === 'string')) {
            const logMsg = "AI върна невалиден формат на RAG ключовете:";
            log(logMsg, keysResponse);
            console.info(logMsg, keysResponse);
            return jsonError('AI върна невалиден формат. Очакван JSON масив, напр.: ["нервна система","панкреас"]', 400, request, env);
        }
        ragKeys = [...new Set(ragKeys.map(k => RAG_KEY_ALIASES[k] || k))];
        log("Получени RAG ключове за извличане:", ragKeys);

        log("Стъпка 2: Извличане на данни от KV базата...");
        const ragData = await fetchRagData(ragKeys, env);
        log("Извлечени са", Object.keys(ragData).length, "записа от KV.");

        log("Стъпка 2.1: Извличане на публични източници...");
        if (env.GOOGLE_API_KEY && env.GOOGLE_CX) {
            const externalInfos = await Promise.all(ragKeys.map(key => fetchExternalInfo(key, env)));
            ragKeys.forEach((key, idx) => {
                const info = externalInfos[idx];
                if (info) {
                    ragData[key] = { ...(ragData[key] || {}), external: info };
                }
            });
        } else {
            log("Пропуснато извличане на публични източници");
        }

        log("Стъпка 3: Изпращане на заявка за финален синтез...");
        const synthesisPrompt = SYNTHESIS_PROMPT_TEMPLATE
            .replace('{{USER_DATA}}', formatUserData(userData))
            .replace('{{RAG_DATA}}', JSON.stringify(ragData, null, 2));

        const synthesisApiCaller = provider === "gemini" ? callGeminiAPI : callOpenAIAPI;
        const rolePrompt = await getRolePrompt(env);
        const analysisSchema = await getAnalysisJsonSchema(env);
        const finalAnalysis = await synthesisApiCaller(
            model,
            synthesisPrompt,
            { systemPrompt: rolePrompt, jsonSchema: analysisSchema },
            leftEyeImage,
            rightEyeImage,
            env,
            true,
            leftEyeUrl,
            rightEyeUrl
        );
        log("Финален анализ е генериран успешно.");

        let parsedAnalysis;
        try {
            parsedAnalysis = JSON.parse(finalAnalysis);
            if (typeof parsedAnalysis.holistic_analysis !== 'string') {
                throw new Error("AI върна анализ без поле 'holistic_analysis'.");
            }
        } catch (e) {
            log("Суров отговор от AI при грешка в парсването на финалния анализ:", finalAnalysis);
            throw e;
        }

        if (env.iris_rag_kv) {
            try {
                await env.iris_rag_kv.put('lastAnalysis', JSON.stringify(parsedAnalysis));
                await env.iris_rag_kv.put('holistic_analysis', parsedAnalysis.holistic_analysis);
            } catch (e) {
                log('Неуспешен запис в KV:', e.message);
            }
        }

        return new Response(JSON.stringify(parsedAnalysis), { headers: corsHeaders(request, env, {'Content-Type': 'application/json; charset=utf-8'}) });

    } catch (error) {
        console.error("Критична грешка в handleAnalysisRequest:", error.stack);
        return jsonError("Вътрешна грешка на сървъра: " + error.message, 500, request, env);
    }
}

// --- AI API ИНТЕГРАЦИИ ---
async function callGeminiAPI(model, prompt, options, leftEye, rightEye, env, expectJson = true, leftEyeUrl, rightEyeUrl) {
    const apiKey = env.gemini_api_key || env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("API ключът за Gemini не е конфигуриран.");
    const modelName = model.endsWith('-latest') ? model : `${model}-latest`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const parts = buildGeminiParts(prompt, leftEye, rightEye, leftEyeUrl, rightEyeUrl);

    const requestBody = {
        contents: [
            {
                role: "user",
                parts,
            }
        ],
        generationConfig: {}
    };

    if (options.systemPrompt) {
        requestBody.system_instruction = { role: "system", parts: [{ text: options.systemPrompt }] };
    }
    if (expectJson) {
        requestBody.generationConfig.response_mime_type = "application/json";
    }
    if (options.maxOutputTokens) {
        requestBody.generationConfig.maxOutputTokens = options.maxOutputTokens;
    }

    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
    const responseData = await response.json();

    if (response.status === 404) {
        throw new Error(`Моделът ${model} не е наличен`);
    }
    if (!response.ok) {
        console.error("Грешка от Gemini API:", JSON.stringify(responseData, null, 2));
        throw new Error(`HTTP ${response.status}`);
    }
    if (!responseData.candidates?.[0]?.content.parts?.[0]?.text) {
        console.error("Грешка от Gemini API:", JSON.stringify(responseData, null, 2));
        throw new Error("Неуспешна или невалидна заявка към Gemini API.");
    }
    return responseData.candidates[0].content.parts[0].text;
}

async function callOpenAIAPI(model, prompt, options = {}, leftEye, rightEye, env, expectJson = true, leftEyeUrl, rightEyeUrl) {
    const apiKey = env.openai_api_key || env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("API ключът за OpenAI не е конфигуриран.");
    const url = "https://api.openai.com/v1/chat/completions";

    const messages = [];
    if (options.systemPrompt) {
        messages.push({ role: "system", content: options.systemPrompt });
    }
    const content = buildOpenAIContent(prompt, leftEye, rightEye, leftEyeUrl, rightEyeUrl);
    messages.push({ role: "user", content });

    const requestBody = { model, messages };
    if (expectJson) {
        if (!options.jsonSchema) {
            throw new Error('jsonSchema е задължителна при expectJson=true');
        }
        requestBody.response_format = {
            type: 'json_schema',
            json_schema: options.jsonSchema
        };
    }
    if (options.max_tokens) {
        requestBody.max_tokens = options.max_tokens;
    }

    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(requestBody) });
    const responseData = await response.json();

    if (response.status === 404) {
        throw new Error(`Моделът ${model} не е наличен`);
    }
    if (!response.ok) {
        console.error("Грешка от OpenAI API:", JSON.stringify(responseData, null, 2));
        throw new Error(`HTTP ${response.status}`);
    }
    if (!responseData.choices?.[0]?.message?.content) {
        console.error("Грешка от OpenAI API:", JSON.stringify(responseData, null, 2));
        throw new Error("Неуспешна или невалидна заявка към OpenAI API.");
    }
    return responseData.choices[0].message.content;
}

// --- ВЪНШНИ ИЗТОЧНИЦИ ---
async function fetchExternalInfo(query, env) {
    try {
        const apiKey = env?.GOOGLE_API_KEY;
        const cx = env?.GOOGLE_CX;
        if (!apiKey || !cx) {
            return null;
        }
        const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${cx}`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        const item = data.items?.[0];
        if (!item) return null;
        return {
            title: item.title,
            summary: item.snippet,
            source: item.link
        };
    } catch (e) {
        console.warn('Неуспешно извличане на външна информация за', query, e);
        return null;
    }
}

// --- RAG ИЗВЛИЧАНЕ ОТ KV ---
export async function fetchRagData(keys, env) {
    const { iris_rag_kv } = env;
    if (!iris_rag_kv) throw new Error("KV Namespace 'iris_rag_kv' не е свързан с този Worker.");

    const cache = /** @type {any} */ (caches).default;
    const ttl = parseInt(env.RAG_CACHE_TTL, 10) || 300;
    const missingKeys = [];

    async function fetchArray(arr = []) {
        if (!Array.isArray(arr) || arr.length === 0) return {};
        const data = {};
        const entries = await Promise.all(arr.map(async key => {
            const cacheReq = new Request(`https://rag-cache/${key}`);
            let value;

            const cached = await cache.match(cacheReq);
            if (cached) {
                try {
                    value = await cached.json();
                } catch (e) {
                    console.warn('Грешка при четене от кеша за ключ', key, e);
                }
            }

            if (!value) {
                value = await iris_rag_kv.get(key, 'json');
                if (value) {
                    await cache.put(
                        cacheReq,
                        new Response(JSON.stringify(value), {
                            headers: { 'Cache-Control': `max-age=${ttl}` }
                        })
                    );
                } else {
                    missingKeys.push(key);
                }
            }

            return value ? [key, value] : null;
        }));

        for (const entry of entries) {
            if (entry) data[entry[0]] = entry[1];
        }
        return data;
    }

    if (Array.isArray(keys)) {
        const result = await fetchArray(keys);
        if (missingKeys.length) {
            console.warn(`Липсващи RAG ключове: ${missingKeys.join(', ')}`);
        }
        return result;
    } else if (keys && typeof keys === 'object') {
        const result = {};
        for (const [cat, arr] of Object.entries(keys)) {
            result[cat] = await fetchArray(arr);
        }
        if (missingKeys.length) {
            console.warn(`Липсващи RAG ключове: ${missingKeys.join(', ')}`);
        }
        return result;
    }
    if (missingKeys.length) {
        console.warn(`Липсващи RAG ключове: ${missingKeys.join(', ')}`);
    }
    return {};
}

// --- СИНТЕЗ НА АНАЛИЗА ---
export async function generateSummary(signs, ragRecords, env = {}, rolePrompt, analysisSchema) {
    const provider = await getAIProvider(env);
    const model = await getAIModel(env);

    const prompt = SYNTHESIS_PROMPT_TEMPLATE
        .replace('{{USER_DATA}}', JSON.stringify({ signs }, null, 2))
        .replace('{{RAG_DATA}}', JSON.stringify(ragRecords, null, 2));

    const systemPrompt = rolePrompt || await getRolePrompt(env);
    const schemaWrapper = analysisSchema
        ? { name: analysisSchema.name || 'analysis', schema: ensureHolisticSchema(analysisSchema.schema || {}) }
        : await getAnalysisJsonSchema(env);
    const apiCaller = provider === 'gemini' ? callGeminiAPI : callOpenAIAPI;
    const aiResponse = await apiCaller(
        model,
        prompt,
        { systemPrompt, jsonSchema: schemaWrapper },
        null,
        null,
        env,
        true,
        null,
        null
    );
    const parsed = JSON.parse(aiResponse);

    const actions = ragRecords && ragRecords.support
        ? Array.isArray(ragRecords.support) ? ragRecords.support : [ragRecords.support]
        : [];

    return { ...parsed, actions };
}

// --- ПОМОЩНИ ФУНКЦИИ ---
function formatUserData(data) {
    return `
 - Име: ${data.name || 'Не е посочено'}
 - Възраст: ${data.age || 'Не е посочена'}
 - Ръст: ${data.height || 'Не е посочен'}
 - Тегло: ${data.weight || 'Не е посочено'}
 - Пол: ${data.gender || 'Не е посочен'}
 - Основно оплакване: ${data.mainComplaint || 'Няма'}
 - Операции/Травми: ${data.surgeries || 'Няма'}
 - Фамилна анамнеза: ${data.familyHistory || 'Няма'}
 - Прием на вода: ${data.water || 'Не е посочен'}
 - Сън: ${data.sleep ? data.sleep + ' часа' : 'Не е посочен'}
 - Ниво на стрес: ${data.stress ? data.stress + '/10' : 'Не е посочено'}
 - Храносмилателна система: ${data.digestive && data.digestive.length ? data.digestive.join(', ') : 'Няма'}
    `;
}

// Проверява дали изображението не надвишава максималния допустим размер.
async function validateImageSize(file, env = {}, maxBytes = 10 * 1024 * 1024) {
    const log = (...args) => debugLog(env, ...args);
    log(`Валидиране на файл: ${file.name}, размер: ${file.size} байта.`);
    if (file.size > maxBytes) {
        throw new Error(`Файлът ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB) надвишава максималния размер от ${maxBytes / 1024 / 1024}MB.`);
    }
    return file;
}

async function fileToBase64(blob, env = {}) {
    await validateImageSize(blob, env);
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    let binary = "";
    bytes.forEach(b => (binary += String.fromCharCode(b)));

    // За текст с Unicode може да се използва:
    // btoa(unescape(encodeURIComponent(binary)))
    const base64 = btoa(binary);

    return { data: base64, type: blob.type };
}

// Качва изображение в R2/S3 и връща временен URL или null при липса на bucket.
async function uploadImageAndGetUrl(file, env = {}, { prefix = 'eye', expiresIn = 300 } = {}) {
    const bucket = env.eye_images || env.EYE_IMAGES;
    if (!bucket || typeof bucket.put !== 'function') return null;
    const key = `${prefix}/${crypto.randomUUID()}`;
    await bucket.put(key, file, { httpMetadata: { contentType: file.type } });
    if (typeof bucket.getPresignedUrl === 'function') {
        const expiration = new Date(Date.now() + expiresIn * 1000);
        const signed = await bucket.getPresignedUrl({ key, method: 'GET', expiration });
        const url = signed?.url ? signed.url.toString() : signed?.toString();
        return url || null;
    }
    return null;
}

// Подготвя данните за изображенията за употреба в различни AI провайдъри
function prepareImages(leftEye, rightEye, leftEyeUrl, rightEyeUrl) {
    const images = [];
    if (leftEyeUrl || leftEye) {
        images.push({ eye: 'left', url: leftEyeUrl, type: leftEye?.type, data: leftEye?.data });
    }
    if (rightEyeUrl || rightEye) {
        images.push({ eye: 'right', url: rightEyeUrl, type: rightEye?.type, data: rightEye?.data });
    }
    return images;
}

function buildGeminiParts(prompt, leftEye, rightEye, leftEyeUrl, rightEyeUrl) {
    const parts = [{ text: prompt }];
    for (const img of prepareImages(leftEye, rightEye, leftEyeUrl, rightEyeUrl)) {
        const meta = { eye: img.eye };
        if (img.url) {
            parts.push({ file_uri: img.url });
        } else if (img.data) {
            parts.push({ inline_data: { mime_type: img.type, data: img.data } });
        }
        parts.push({ text: JSON.stringify(meta) });
    }
    return parts;
}

function buildOpenAIContent(prompt, leftEye, rightEye, leftEyeUrl, rightEyeUrl) {
    /** @type {Array<{type:string,text?:string,image_url?:{url:string}}>} */
    const content = [{ type: 'text', text: prompt }];
    for (const img of prepareImages(leftEye, rightEye, leftEyeUrl, rightEyeUrl)) {
        const meta = { eye: img.eye };
        if (img.url) {
            content.push({ type: 'image_url', image_url: { url: img.url } });
        } else if (img.data) {
            content.push({ type: 'image_url', image_url: { url: `data:${img.type};base64,${img.data}` } });
        }
        content.push({ type: 'text', text: JSON.stringify(meta) });
    }
    return content;
}

function handleOptions(request, env) {
    return new Response(null, { headers: corsHeaders(request, env) });
}

// Връща коректни CORS заглавки. Поддържа креденшъли при нужда.
function corsHeaders(request, env = {}, additionalHeaders = {}) {
    const requestOrigin = request.headers.get("Origin");

    // Cloudflare secrets са низове, затова използваме split.
    // Позволява множество разрешени адреси, разделени със запетая.
    const allowedOrigins = (env.ALLOWED_ORIGINS || env.allowed_origin || "*")
        .split(",")
        .map(o => o.trim())
        .filter(Boolean);

    let origin = "null"; // По подразбиране блокираме
    if (allowedOrigins.includes("*")) {
        // При wildcard връщаме конкретния Origin, за да позволим креденшъли
        origin = requestOrigin || "null";
    } else if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
        origin = requestOrigin;
    }

    const headers = {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
        ...additionalHeaders,
    };

    // Ако заявката носи креденшъли (Authorization/Cookie), ги позволяваме
    const needsCredentials =
        request.headers.get("Authorization") ||
        request.headers.get("Cookie") ||
        ((request.headers.get("Access-Control-Request-Headers") || "")
            .split(",")
            .map(h => h.trim().toLowerCase())
            .includes("authorization"));
    if (needsCredentials && origin !== "null") {
        headers["Access-Control-Allow-Credentials"] = "true";
    }

    if (origin !== "*") {
        headers["Vary"] = "Origin";
    }

    return new Headers(headers);
}

function jsonError(message, status = 400, request, env, extraHeaders = {}) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: corsHeaders(request, env, {
            'Content-Type': 'application/json; charset=utf-8',
            ...extraHeaders,
        }),
    });
}

export { validateImageSize, fileToBase64, uploadImageAndGetUrl, corsHeaders, callOpenAIAPI, callGeminiAPI, fetchExternalInfo, RAG_KEYS_JSON_SCHEMA, ANALYSIS_JSON_SCHEMA, getAnalysisJsonSchema };
