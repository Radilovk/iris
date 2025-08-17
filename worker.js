import { KV_DATA } from './kv-data.js';

// Инлайн на ROLE_PROMPT, за да няма външни зависимости при деплой
const ROLE_PROMPT = `
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
3. Използвай единствено информацията от входните данни и RAG.
4. Ако липсва информация, заяви го изрично и не прави предположения.
5. Не поставяй медицински диагнози и не предписвай лечение; формулирай анализите като образователни насоки.

# ВАЖЕН ДИСКЛЕЙМЪР
**Винаги завършвай всеки анализ с този РАЗШИРЕН текст:**
"Важно: Този анализ е базиран на принципите на ирисовата и склерологичната диагностика и има образователен характер. Той не представлява медицинска диагноза, лечение или препоръка. При здравословни проблеми се консултирайте с квалифициран медицински специалист."
`;

// --- КОНФИГУРАЦИЯ ---
// Чете AI_PROVIDER от environment с подразбиране към "gemini"
export function getAIProvider(env = {}) {
    return env.AI_PROVIDER || "gemini";
}

// --- ОТЛОГВАНЕ ---
function debugLog(env = {}, ...args) {
    if (env.DEBUG === "true") {
        console.log("[DEBUG]", ...args);
    }
}

function toBase64(str) {
    if (typeof btoa !== 'undefined') return btoa(str);
    return Buffer.from(str, 'utf8').toString('base64');
}

// --- ПРОМПТОВЕ ---
const IDENTIFICATION_PROMPT = `
# ЗАДАЧА: ИДЕНТИФИКАЦИЯ НА ЗНАЦИ
Ти си AI асистент, специализиран в разпознаването на ирисови знаци. Разгледай предоставените снимки на ляво и дясно око.
Твоята ЕДИНСТВЕНА задача е да идентифицираш всички значими конституционални типове, предразположения, диатези, специфични знаци,
миазми, синдроми, емоционални връзки и общи препоръки.
Резултатът трябва да бъде **ЕДИНСТВЕНО JSON масив от низове (string array)**, съдържащ съответните RAG ключове за всеки идентифициран знак.
Не добавяй никакви обяснения. Само JSON масив.

Пример за изход:
["CONSTITUTION:COLOR:MIXED_BILIARY", "DISPOSITION:STRUCTURE:FLEXIBLE_ADAPTIVE", "SIGN:IRIS:RING:CONTRACTION_FURROWS", "SIGN:PUPIL:GENERAL_ANALYSIS", "MIASM:PSORA", "SYNDROME:CARDIO_RENAL", "EMOTION:IRIS:LIVER", "RECOMMENDATION:PRINCIPLE:NUTRITIONAL_FOUNDATION"]
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

Моля, използвай RAG данните като основен източник на истина за твоя анализ. Сега, генерирай финалния JSON доклад.
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
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    },
};

async function handleAdmin(request, env) {
    if (!verifyBasicAuth(request, env)) {
        return new Response('Unauthorized', {
            status: 401,
            headers: { 'WWW-Authenticate': 'Basic realm="Admin"' }
        });
    }

    if (env.ADMIN_IPS) {
        const ip = request.headers.get('CF-Connecting-IP');
        const allowed = env.ADMIN_IPS.split(',').map(i => i.trim());
        if (!ip || !allowed.includes(ip)) {
            return new Response('Forbidden', { status: 403 });
        }
    }

    const url = new URL(request.url);
    if (url.pathname === '/admin/sync' && request.method === 'POST') {
        return adminSync(env);
    }
    if (url.pathname === '/admin/keys' && request.method === 'GET') {
        return adminKeys(env);
    }
    return new Response('Not Found', { status: 404 });
}

function verifyBasicAuth(request, env) {
    const user = env.ADMIN_USER || 'admin';
    const pass = env.ADMIN_PASS || 'admin';
    const expected = 'Basic ' + toBase64(`${user}:${pass}`);
    return request.headers.get('Authorization') === expected;
}

async function adminSync(env) {
    const { CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN } = env;
    if (!CF_ACCOUNT_ID || !CF_KV_NAMESPACE_ID || !CF_API_TOKEN) {
        return new Response('Липсват CF_* променливи.', { status: 500 });
    }

    const verify = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` }
    });
    if (!verify.ok) {
        const text = await verify.text();
        return new Response(text, { status: 500 });
    }

    const files = Object.keys(KV_DATA);
    const existingKeys = await fetchExistingKeysCF(env);
    const toDelete = existingKeys.filter(k => !files.includes(k));

    const entries = [];
    for (const file of files) {
        const value = KV_DATA[file];
        try {
            JSON.parse(value);
        } catch (err) {
            return new Response(`Невалиден JSON в ${file}`, { status: 500 });
        }
        entries.push({ key: file, value });
    }
    for (const key of toDelete) {
        entries.push({ key, delete: true });
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/bulk`;
    const res = await fetch(url, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${CF_API_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(entries)
    });

    if (!res.ok) {
        const text = await res.text();
        return new Response(text, { status: 500 });
    }

    return new Response(JSON.stringify({ updated: files, deleted: toDelete }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function adminKeys(env) {
    try {
        const keys = await fetchExistingKeysCF(env);
        return new Response(JSON.stringify({ keys }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function fetchExistingKeysCF(env) {
    const { CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN } = env;
    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/keys`;
    const keys = [];
    let cursor;
    do {
        const params = new URLSearchParams({ limit: '1000' });
        if (cursor) params.set('cursor', cursor);
        const res = await fetch(`${baseUrl}?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` }
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

// --- ОРКЕСТРАТОР НА АНАЛИЗА ---
async function handleAnalysisRequest(request, env) {
    const log = (...args) => debugLog(env, ...args);
    const provider = getAIProvider(env);
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
        const keysResponse = await identificationApiCaller(IDENTIFICATION_PROMPT, {}, leftEyeBase64, rightEyeBase64, env, true);
        
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

        log("Стъпка 3: Изпращане на заявка за финален синтез...");
        const synthesisPrompt = SYNTHESIS_PROMPT_TEMPLATE
            .replace('{{USER_DATA}}', formatUserData(userData))
            .replace('{{RAG_DATA}}', JSON.stringify(ragData, null, 2));

        const synthesisApiCaller = provider === "gemini" ? callGeminiAPI : callOpenAIAPI;
        const finalAnalysis = await synthesisApiCaller(synthesisPrompt, { systemPrompt: ROLE_PROMPT }, leftEyeBase64, rightEyeBase64, env, true);
        log("Финален анализ е генериран успешно.");

        return new Response(finalAnalysis, { headers: corsHeaders(request, env, {'Content-Type': 'application/json; charset=utf-8'}) });

    } catch (error) {
        console.error("Критична грешка в handleAnalysisRequest:", error.stack);
        return new Response(JSON.stringify({ error: "Вътрешна грешка на сървъра: " + error.message }), { status: 500, headers: corsHeaders(request, env) });
    }
}

// --- AI API ИНТЕГРАЦИИ ---
async function callGeminiAPI(prompt, options, leftEyeBase64, rightEyeBase64, env, expectJson = true) {
    const apiKey = env.gemini_api_key;
    if (!apiKey) throw new Error("API ключът за Gemini не е конфигуриран.");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

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

async function callOpenAIAPI(prompt, options, leftEyeBase64, rightEyeBase64, env, expectJson = true) {
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

    const requestBody = { model: "gpt-4o", messages };
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

function corsHeaders(request, env = {}, additionalHeaders = {}) {
    const requestOrigin = request.headers.get("Origin");

    // Cloudflare secrets са низове, затова използваме split.
    // Позволява множество разрешени адреси, разделени със запетая.
    const allowedOrigins = (env.ALLOWED_ORIGINS || env.allowed_origin || "https://radilovk.github.io").split(",");
    
    let origin = "null"; // По подразбиране блокираме
    if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
        origin = requestOrigin;
    } else if (allowedOrigins.includes("*")) {
        origin = "*";
    }
    
    // КОРЕКЦИЯ #2: Използваме динамично определения 'origin'
    const headers = {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        ...additionalHeaders,
    };

    if (origin !== "*") {
        headers["Vary"] = "Origin";
    }

    return new Headers(headers);
}

export { resizeImage, fileToBase64, corsHeaders };
