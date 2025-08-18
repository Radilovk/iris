import { validateKv, syncKv } from "./kv-sync.js";

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
4. Ако липсва информация, заяви го изрично и не прави предположения.
5. Не поставяй медицински диагнози и не предписвай лечение; формулирай анализите като образователни насоки.

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
            if (typeof val === 'string') return val;
        } catch (e) {
            console.warn('Неуспешно извличане на AI_MODEL от KV:', e);
        }
    }
    const provider = await getAIProvider(env);
    return provider === 'openai' ? 'gpt-4o' : 'gemini-1.5-pro';
}

// --- ОТЛОГВАНЕ ---
function debugLog(env = {}, ...args) {
    if (env.DEBUG === "true") {
        console.log("[DEBUG]", ...args);
    }
}

function toBase64(str) {
    return btoa(str);
}

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
["CONSTITUTION:...","DISPOSITION:..."]
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
    if (!verifyBasicAuth(request, env)) {
        return new Response('Unauthorized', {
            status: 401,
            headers: corsHeaders(request, env, { 'WWW-Authenticate': 'Basic realm="Admin"' })
        });
    }

    if (env.ADMIN_IPS) {
        const ip = request.headers.get('CF-Connecting-IP');
        const allowed = env.ADMIN_IPS.split(',').map(i => i.trim());
        if (!ip || !allowed.includes(ip)) {
            return new Response('Forbidden', { status: 403, headers: corsHeaders(request, env) });
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
    if (url.pathname === '/admin/get' && request.method === 'GET') {
        const key = url.searchParams.get('key');
        return adminGet(env, request, key);
    }
    if (url.pathname === '/admin/put' && request.method === 'PUT') {
        return adminPut(env, request);
    }
    if (url.pathname === '/admin/delete' && request.method === 'DELETE') {
        const key = url.searchParams.get('key');
        return adminDelete(env, request, key);
    }
    return new Response('Not Found', { status: 404, headers: corsHeaders(request, env) });
}

function verifyBasicAuth(request, env) {
    const user = env.ADMIN_USER || 'admin';
    const pass = env.ADMIN_PASS || 'admin';
    const expected = 'Basic ' + toBase64(`${user}:${pass}`);
    return request.headers.get('Authorization') === expected;
}

async function adminDiff(env, request) {
    let data;
    try {
        data = await request.json();
    } catch {
        return new Response('Невалиден JSON', { status: 400, headers: corsHeaders(request, env) });
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
            return new Response(`Невалиден JSON в ${file}`, { status: 400, headers: corsHeaders(request, env) });
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
    let data;
    try {
        data = await request.json();
    } catch {
        return new Response("Невалиден JSON", { status: 400, headers: corsHeaders(request, env) });
    }

    let entries;
    try {
        entries = validateKv(data);
    } catch (err) {
        return new Response(err.message, { status: 400, headers: corsHeaders(request, env) });
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
        return new Response(err.message, { status: 500, headers: corsHeaders(request, env) });
    }
}

async function adminKeys(env, request) {
    try {
        const { keys } = await env.iris_rag_kv.list({ limit: 1000 });
        return new Response(JSON.stringify({ keys: keys.map(k => k.name) }), {
            headers: corsHeaders(request, env, { 'Content-Type': 'application/json' })
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: corsHeaders(request, env, { 'Content-Type': 'application/json' })
        });
    }
}

async function adminGet(env, request, key) {
    if (!key) {
        return new Response('Missing key parameter', { status: 400, headers: corsHeaders(request, env) });
    }
    try {
        const value = await env.iris_rag_kv.get(key);
        if (value === null) {
            return new Response('Not Found', { status: 404, headers: corsHeaders(request, env) });
        }
        return new Response(JSON.stringify({ key, value }), {
            headers: corsHeaders(request, env, { 'Content-Type': 'application/json' })
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: corsHeaders(request, env, { 'Content-Type': 'application/json' })
        });
    }
}

async function adminPut(env, request) {
    try {
        const { key, value } = await request.json();
        if (!key || typeof value === 'undefined') {
            return new Response('Missing key or value', { status: 400, headers: corsHeaders(request, env) });
        }
        try {
            JSON.parse(value);
        } catch (err) {
            return new Response('Невалиден JSON', { status: 400, headers: corsHeaders(request, env) });
        }
        const exists = await env.iris_rag_kv.get(key);
        await env.iris_rag_kv.put(key, value);
        return new Response(JSON.stringify({ ok: true, created: !exists }), {
            headers: corsHeaders(request, env, { 'Content-Type': 'application/json' })
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: corsHeaders(request, env, { 'Content-Type': 'application/json' })
        });
    }
}

async function adminDelete(env, request, key) {
    if (!key) {
        return new Response('Missing key parameter', { status: 400, headers: corsHeaders(request, env) });
    }
    try {
        await env.iris_rag_kv.delete(key);
        return new Response(JSON.stringify({ deleted: key }), {
            headers: corsHeaders(request, env, { 'Content-Type': 'application/json' })
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: corsHeaders(request, env, { 'Content-Type': 'application/json' })
        });
    }
}


// --- ОРКЕСТРАТОР НА АНАЛИЗА ---
async function handleAnalysisRequest(request, env) {
    const log = (...args) => debugLog(env, ...args);
    const provider = await getAIProvider(env);
    const model = await getAIModel(env);
    try {
        log("Получена е нова заявка за анализ.");
        const formData = await request.formData();

        const leftEyeFile = formData.get("left-eye");
        const rightEyeFile = formData.get("right-eye");
        if (!leftEyeFile || !rightEyeFile) throw new Error("Липсват файлове за ляво или дясно око.");
        
        const userData = {
            name: formData.get("name"), age: formData.get("age"), mainComplaint: formData.get("main-complaint"),
            surgeries: formData.get("surgeries"), familyHistory: formData.get("family-history"), diet: formData.get("diet"),
            water: formData.get("water"), sleep: formData.get("sleep"), stress: formData.get("stress"),
        };
        const leftEyeBase64 = await fileToBase64(leftEyeFile, env);
        const rightEyeBase64 = await fileToBase64(rightEyeFile, env);
        log("Данните от формуляра са обработени успешно.");

        log("Стъпка 1: Изпращане на заявка за идентификация на знаци...");
        const identificationApiCaller = provider === "gemini" ? callGeminiAPI : callOpenAIAPI;
        const keysResponse = await identificationApiCaller(model, IDENTIFICATION_PROMPT, {}, leftEyeBase64, rightEyeBase64, env, true);
        
        let ragKeys;
        try {
            ragKeys = JSON.parse(keysResponse);
            if (!Array.isArray(ragKeys) || !ragKeys.every(k => typeof k === 'string')) {
                throw new Error("AI върна невалиден формат на RAG ключовете.");
            }
        } catch (parseError) {
            log("Суров отговор от AI при грешка в парсването:", keysResponse);
            throw new Error(`Невалиден JSON от AI в стъпка 1: ${parseError.message}`);
        }
        log("Получени RAG ключове за извличане:", ragKeys);

        log("Стъпка 2: Извличане на данни от KV базата...");
        const ragData = await fetchRagData(ragKeys, env);
        log("Извлечени са", Object.keys(ragData).length, "записа от KV.");

        log("Стъпка 2.1: Извличане на публични източници...");
        const externalInfos = await Promise.all(ragKeys.map(key => fetchExternalInfo(key)));
        ragKeys.forEach((key, idx) => {
            const info = externalInfos[idx];
            if (info) {
                ragData[key] = { ...(ragData[key] || {}), external: info };
            }
        });

        log("Стъпка 3: Изпращане на заявка за финален синтез...");
        const synthesisPrompt = SYNTHESIS_PROMPT_TEMPLATE
            .replace('{{USER_DATA}}', formatUserData(userData))
            .replace('{{RAG_DATA}}', JSON.stringify(ragData, null, 2));

        const synthesisApiCaller = provider === "gemini" ? callGeminiAPI : callOpenAIAPI;
        const rolePrompt = await getRolePrompt(env);
        const finalAnalysis = await synthesisApiCaller(model, synthesisPrompt, { systemPrompt: rolePrompt }, leftEyeBase64, rightEyeBase64, env, true);
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

        if (typeof localStorage !== 'undefined') {
            try {
                localStorage.setItem('lastAnalysis', JSON.stringify(parsedAnalysis));
                localStorage.setItem('holistic_analysis', parsedAnalysis.holistic_analysis);
            } catch (e) {
                log('Неуспешен запис в localStorage:', e.message);
            }
        }

        return new Response(JSON.stringify(parsedAnalysis), { headers: corsHeaders(request, env, {'Content-Type': 'application/json; charset=utf-8'}) });

    } catch (error) {
        console.error("Критична грешка в handleAnalysisRequest:", error.stack);
        return new Response(JSON.stringify({ error: "Вътрешна грешка на сървъра: " + error.message }), { status: 500, headers: corsHeaders(request, env) });
    }
}

// --- AI API ИНТЕГРАЦИИ ---
async function callGeminiAPI(model, prompt, options, leftEyeBase64, rightEyeBase64, env, expectJson = true) {
    const apiKey = env.gemini_api_key;
    if (!apiKey) throw new Error("API ключът за Gemini не е конфигуриран.");
    const modelName = model.endsWith('-latest') ? model : `${model}-latest`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const requestBody = {
        contents: [
            {
                role: "user",
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: "image/jpeg", data: leftEyeBase64 }},
                    { text: "\n(Снимка на ЛЯВО око)" },
                    { inline_data: { mime_type: "image/jpeg", data: rightEyeBase64 }},
                    { text: "\n(Снимка на ДЯСНО око)" }
                ]
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

    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
    const responseData = await response.json();

    if (!response.ok || !responseData.candidates?.[0]?.content.parts?.[0]?.text) {
        console.error("Грешка от Gemini API:", JSON.stringify(responseData, null, 2));
        throw new Error("Неуспешна или невалидна заявка към Gemini API.");
    }
    return responseData.candidates[0].content.parts[0].text;
}

async function callOpenAIAPI(model, prompt, options, leftEyeBase64, rightEyeBase64, env, expectJson = true) {
    const apiKey = env.openai_api_key;
    if (!apiKey) throw new Error("API ключът за OpenAI не е конфигуриран.");
    const url = "https://api.openai.com/v1/chat/completions";

    const messages = [];
    if (options.systemPrompt) {
        messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({
        role: "user",
        content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${leftEyeBase64}` }},
            { type: "text", text: "\n(Снимка на ЛЯВО око)" },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${rightEyeBase64}` }},
            { type: "text", text: "\n(Снимка на ДЯСНО око)" }
        ]
    });

    const requestBody = { model, messages };
    if (expectJson) {
        requestBody.response_format = { type: "json_object" };
    }

    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(requestBody) });
    const responseData = await response.json();
    
    if (!response.ok || !responseData.choices?.[0]?.message?.content) {
        console.error("Грешка от OpenAI API:", JSON.stringify(responseData, null, 2));
        throw new Error("Неуспешна или невалидна заявка към OpenAI API.");
    }
    return responseData.choices[0].message.content;
}

// --- ВЪНШНИ ИЗТОЧНИЦИ ---
async function fetchExternalInfo(query) {
    try {
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        return {
            title: data.title,
            summary: data.extract,
            source: data.content_urls?.desktop?.page || data.canonicalurl || url
        };
    } catch (e) {
        console.warn('Неуспешно извличане на външна информация за', query, e);
        return null;
    }
}

// --- RAG ИЗВЛИЧАНЕ ОТ KV ---
async function fetchRagData(keys, env) {
    if (!Array.isArray(keys) || keys.length === 0) {
        return {};
    }
    const { iris_rag_kv } = env;
    if (!iris_rag_kv) throw new Error("KV Namespace 'iris_rag_kv' не е свързан с този Worker.");

    const promises = keys.map(key => iris_rag_kv.get(key, 'json'));
    const results = await Promise.all(promises);
    
    const data = {};
    results.forEach((value, index) => {
        if (value) {
            data[keys[index]] = value;
        } else {
            console.warn(`Ключ '${keys[index]}' не е намерен в KV базата.`);
        }
    });
    return data;
}

// --- ПОМОЩНИ ФУНКЦИИ ---
function formatUserData(data) {
    return `
- Име: ${data.name || 'Не е посочено'}
- Възраст: ${data.age || 'Не е посочена'}
- Основно оплакване: ${data.mainComplaint || 'Няма'}
- Операции/Травми: ${data.surgeries || 'Няма'}
- Фамилна анамнеза: ${data.familyHistory || 'Няма'}
- Диета: ${data.diet || 'Не е посочена'}
- Прием на вода: ${data.water || 'Не е посочен'}
- Сън: ${data.sleep ? data.sleep + ' часа' : 'Не е посочен'}
- Ниво на стрес: ${data.stress ? data.stress + '/10' : 'Не е посочено'}
    `;
}

// ПРЕПОРЪКА #3: Преименувана функция за по-голяма яснота
async function validateImageSize(file, env = {}, maxBytes = 5 * 1024 * 1024) {
    const log = (...args) => debugLog(env, ...args);
    log(`Валидиране на файл: ${file.name}, размер: ${file.size} байта.`);
    if (file.size > maxBytes) {
        throw new Error(`Файлът ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB) надвишава максималния размер от ${maxBytes / 1024 / 1024}MB.`);
    }
    return file;
}

async function resizeImage(file, env = {}, maxBytes = 5 * 1024 * 1024) {
    await validateImageSize(file, env, maxBytes);
    return file;
}

async function fileToBase64(file, env = {}) {
    await validateImageSize(file, env);
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function handleOptions(request, env) {
    return new Response(null, { headers: corsHeaders(request, env) });
}

// Връща коректни CORS заглавки. Поддържа креденшъли при нужда.
function corsHeaders(request, env = {}, additionalHeaders = {}) {
    const requestOrigin = request.headers.get("Origin");

    // Cloudflare secrets са низове, затова използваме split.
    // Позволява множество разрешени адреси, разделени със запетая.
    const allowedOrigins = (env.ALLOWED_ORIGINS || env.allowed_origin || "*").split(",");

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

export { resizeImage, fileToBase64, corsHeaders, callOpenAIAPI, callGeminiAPI };
