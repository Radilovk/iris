import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { __testables__ } from './worker.js';

const env = {
  iris_rag_kv: {
    get: (key) =>
      key === 'iris_config_kv'
        ? Promise.resolve({
          provider: 'gemini',
          analysis_prompt: '',
          analysis_model: 'gemini-1.5-flash-latest',
          report_prompt: '',
          report_model: 'gemini-1.5-flash-latest'
        })
        : Promise.resolve(null)
  }
};

test('Worker не използва браузърни API', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.localStorage, 'undefined');
});

test('OPTIONS заявка връща CORS хедъри', async () => {
  const req = new Request('https://example.com', { method: 'OPTIONS' });
  const res = await worker.fetch(req, env, { waitUntil(){} });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
});

test('GET заявка връща 405', async () => {
  const req = new Request('https://example.com', { method: 'GET' });
  const res = await worker.fetch(req, env, { waitUntil(){} });
  assert.equal(res.status, 405);
});

test('POST без снимки връща 400', async () => {
  const form = new FormData();
  const req = new Request('https://example.com', { method: 'POST', body: form });
  const res = await worker.fetch(req, env, { waitUntil(){} });
  assert.equal(res.status, 400);
});

test('POST връща 503 при липса на AI модели в конфигурацията', async () => {
  const missingModelsEnv = {
    iris_rag_kv: {
      get: (key) => {
        if (key === 'iris_config_kv') {
          return Promise.resolve({
            provider: 'openai',
            analysis_model: '   ',
            report_model: ''
          });
        }
        return Promise.resolve({});
      }
    }
  };

  const form = new FormData();
  form.append('left-eye-upload', new File(['left'], 'left.png', { type: 'image/png' }));
  form.append('right-eye-upload', new File(['right'], 'right.png', { type: 'image/png' }));

  const req = new Request('https://example.com', { method: 'POST', body: form });

  const originalError = console.error;
  let capturedLog = '';
  console.error = (...args) => {
    capturedLog = args.join(' ');
  };

  try {
    const res = await worker.fetch(req, missingModelsEnv, { waitUntil(){} });
    assert.equal(res.status, 503);

    const payload = await res.json();
    assert.equal(payload.error, 'Конфигурацията на AI моделите е непълна. Моля, задайте analysis_model и report_model.');
    assert.ok(capturedLog.includes('analysis_model'), 'Очаквахме да се логне предупреждение за липсващи модели.');
  } finally {
    console.error = originalError;
  }
});

test('analyzeImageWithVision използва външен контекст вместо плейсхолдър', async () => {
  const originalFetch = global.fetch;
  const prompts = [];

  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.messages[0].content[0].text;
    prompts.push(prompt);

    const responsePayload = {
      choices: [
        {
          message: {
            content: JSON.stringify({ eye: 'ляво око', identified_signs: [] })
          }
        }
      ]
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const file = new File(['123'], 'left-eye.png', { type: 'image/png' });
    const irisMap = { region: 'digestive' };
    const config = {
      provider: 'openai',
      analysis_model: 'gpt-4o-mini',
      analysis_prompt_template: 'Око: {{EYE_IDENTIFIER}}\nКонтекст: {{EXTERNAL_CONTEXT}}'
    };

    const externalContextPayload = JSON.stringify([
      { source: 'Serper', summary: 'B12 deficiency link' }
    ]);

    // Нов аргумент externalContextPayload гарантира, че Vision промптът вижда реалните данни.
    await __testables__.analyzeImageWithVision(
      file,
      'ляво око',
      irisMap,
      config,
      'test-api-key',
      externalContextPayload
    );

    assert.equal(prompts.length, 1);
    assert.ok(prompts[0].includes('B12 deficiency link'));
    assert.ok(!prompts[0].includes('{{EXTERNAL_CONTEXT}}'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('analyzeImageWithVision хвърля AiRefusalError при отказ с празно съдържание', async () => {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const capturedLogs = [];

  global.fetch = async () => {
    const responsePayload = {
      choices: [
        {
          finish_reason: 'content_filter',
          message: { content: null, refusal: 'Content filtered' }
        }
      ]
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  console.warn = (...args) => {
    capturedLogs.push(args);
  };

  try {
    await assert.rejects(
      () =>
        __testables__.analyzeImageWithVision(
          new File(['x'], 'eye.png', { type: 'image/png' }),
          'ляво око',
          {},
          {
            provider: 'openai',
            analysis_model: 'gpt-4o-mini',
            analysis_prompt_template: 'Контекст: {{EXTERNAL_CONTEXT}}'
          },
          'test-api-key',
          '[]'
        ),
      (error) => {
        assert.equal(error.name, 'AiRefusalError');
        assert.equal(error.message, 'AI моделът отказа да изпълни заявката.');
        assert.equal(error.reason, 'Content filtered');
        return true;
      }
    );

    const logHasReason = capturedLogs.some((entry) =>
      entry.some((part) => part && typeof part === 'object' && part.finish_reason === 'content_filter')
    );

    assert.ok(logHasReason, 'Очаквахме логът да съдържа finish_reason.');
  } finally {
    global.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test('analyzeImageWithVision приема масив от части в content', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => {
    const responsePayload = {
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: '{"ok":1}' }
            ]
          }
        }
      ]
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const result = await __testables__.analyzeImageWithVision(
      new File(['y'], 'eye.png', { type: 'image/png' }),
      'ляво око',
      {},
      {
        provider: 'openai',
        analysis_model: 'gpt-4o-mini',
        analysis_prompt_template: 'Контекст: {{EXTERNAL_CONTEXT}}'
      },
      'test-api-key',
      '[]'
    );

    assert.deepEqual(result, { ok: 1 });
  } finally {
    global.fetch = originalFetch;
  }
});

test('analyzeImageWithVision с gpt-4o-search-preview активира web_search', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });

    if (typeof url === 'string' && url.endsWith('/assistants')) {
      return new Response(JSON.stringify({ id: 'asst_test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (typeof url === 'string' && url.endsWith('/threads')) {
      return new Response(JSON.stringify({ id: 'thread_test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (typeof url === 'string' && url.includes('/runs') && options.method === 'POST') {
      return new Response(JSON.stringify({ id: 'run_test', status: 'queued' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (typeof url === 'string' && url.includes('/runs/run_test') && options.method === 'GET') {
      return new Response(JSON.stringify({ id: 'run_test', status: 'completed' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (typeof url === 'string' && url.includes('/messages')) {
      return new Response(JSON.stringify({
        data: [
          {
            id: 'msg_test',
            role: 'assistant',
            run_id: 'run_test',
            content: [
              { type: 'output_text', text: { value: JSON.stringify({ eye: 'ляво око', identified_signs: [] }) } }
            ]
          }
        ]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    throw new Error(`Непознат URL: ${url}`);
  };

  try {
    const result = await __testables__.analyzeImageWithVision(
      new File(['img'], 'eye.png', { type: 'image/png' }),
      'ляво око',
      {},
      {
        provider: 'openai',
        analysis_model: 'gpt-4o-search-preview',
        analysis_prompt_template: 'Око: {{EYE_IDENTIFIER}}'
      },
      'key'
    );

    const runCall = calls.find((call) =>
      typeof call.url === 'string' && call.url.includes('/runs') && call.options.method === 'POST'
    );

    assert.ok(runCall, 'Очаквахме POST към /runs.');

    const runPayload = JSON.parse(runCall.options.body);
    assert.equal(runPayload.web_search.enable, true);

    assert.deepEqual(result, { eye: 'ляво око', identified_signs: [] });
  } finally {
    global.fetch = originalFetch;
  }
});

test('runSearchPreview връща нормализиран JSON от assistant', async () => {
  const originalFetch = global.fetch;
  const payloads = [];

  global.fetch = async (url, options = {}) => {
    payloads.push({ url, options });

    if (typeof url === 'string' && url.endsWith('/threads')) {
      return new Response(JSON.stringify({ id: 'thread_direct' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (typeof url === 'string' && url.includes('/runs') && options.method === 'POST') {
      return new Response(JSON.stringify({ id: 'run_direct', status: 'queued' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (typeof url === 'string' && url.includes('/runs/run_direct') && options.method === 'GET') {
      return new Response(JSON.stringify({ id: 'run_direct', status: 'completed' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (typeof url === 'string' && url.includes('/messages')) {
      return new Response(JSON.stringify({
        data: [
          {
            id: 'msg_direct',
            role: 'assistant',
            run_id: 'run_direct',
            content: [
              { type: 'output_text', text: { value: '{"ok":true}' } }
            ]
          }
        ]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (typeof url === 'string' && url.endsWith('/assistants')) {
      return new Response(JSON.stringify({ id: 'assistant_direct' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    throw new Error(`Непознат URL: ${url}`);
  };

  try {
    const result = await __testables__.runSearchPreview({
      apiKey: 'key',
      prompt: 'Върни JSON',
      responseFormat: { type: 'json_object' }
    });

    assert.deepEqual(result, { ok: true });

    const runPayload = JSON.parse(
      payloads.find((call) => typeof call.url === 'string' && call.url.includes('/runs') && call.options.method === 'POST').options.body
    );

    assert.equal(runPayload.web_search.enable, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Цел „Диабет тип 2“ връща насочени секции вместо fallback', () => {
  const keywords = __testables__.buildKeywordSet([], { 'main-goals': 'Диабет тип 2' });

  assert.ok(keywords.has('type_2_diabetes'));

  const knowledge = {
    scientific_validation_summary: 'Валидирано съдържание.',
    type_2_diabetes: {
      summary: 'Персонални насоки при диабет тип 2.',
      remedy_link: 'баланс на кръвната захар'
    }
  };

  const { filteredKnowledge, matchedRemedyLinks } =
    __testables__.selectRelevantInterpretationKnowledge(knowledge, keywords);

  assert.equal(filteredKnowledge.type_2_diabetes.summary, 'Персонални насоки при диабет тип 2.');
  assert.ok(
    !filteredKnowledge.summary ||
      !filteredKnowledge.summary.includes('Няма директно открити секции в базата')
  );

  const remedyBase = {
    foundational_principles: ['Винаги се консултирай с лекар.'],
    type_2_diabetes: {
      name: 'Подход за диабет тип 2',
      description: 'Препоръки за хранене и движение.'
    },
    summary: 'Това е общ fallback, който не трябва да се връща.'
  };

  const filteredRemedy = __testables__.selectRelevantRemedyBase(
    remedyBase,
    matchedRemedyLinks,
    keywords
  );

  assert.equal(filteredRemedy.type_2_diabetes.name, 'Подход за диабет тип 2');
  assert.ok(
    !filteredRemedy.summary ||
      filteredRemedy.summary !== 'Няма директно съвпадащи препоръки; използвай професионална преценка.'
  );
});

test('generateHolisticReport подава релевантни секции и ги реферира в изхода', async () => {
  const originalFetch = global.fetch;
  const prompts = [];

  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.messages[0].content;
    prompts.push(prompt);

    const responsePayload = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: 'Обобщение за Мария',
              references: ['nervine_support', 'stress_resilience', 'longevity_protocol'],
              sections: {
                recommendations: 'Препоръките стъпват върху nervine_support, stress_resilience и longevity_protocol.'
              }
            })
          }
        }
      ]
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const leftEyeAnalysis = {
    eye: 'ляво око',
    constitutional_analysis: {},
    identified_signs: [
      { sign_name: 'Нервни пръстени', location: 'Зона 7', description: 'Три отчетливи пръстена' }
    ]
  };

  const rightEyeAnalysis = {
    eye: 'дясно око',
    constitutional_analysis: {},
    identified_signs: []
  };

  const interpretationKnowledge = {
    scientific_validation_summary: { title: 'Валидация', summary: 'AI валидирани резултати.' },
    analysis_flow: { steps: ['Стъпка 1', 'Стъпка 2'] },
    special_patterns: [
      {
        name: 'Нервни пръстени',
        summary: 'Показват натоварена нервна система.',
        remedy_link: 'nervine_support'
      },
      {
        name: 'Лимфни лакуни',
        summary: 'Маркер за лимфен застой.',
        remedy_link: 'lymph_support'
      }
    ]
  };

  interpretationKnowledge.goal_alignment = [
    {
      name: 'Антиейджинг фокус',
      summary: 'Антиейджинг програмите са приоритет при антиейджинг цел.',
      remedy_link: 'longevity_protocol'
    }
  ];

  interpretationKnowledge.stress_patterns = [
    {
      name: 'Високо ниво на стрес',
      summary: 'Високо ниво на стрес изисква адаптогенна подкрепа.',
      remedy_link: 'stress_resilience'
    }
  ];

  const remedyBase = {
    foundational_principles: { title: 'Основи', principles: [] },
    targeted_protocols: {
      nervine_support: { title: 'Нервно успокояване', description: 'Използвай магнезий и адаптогени.' },
      lymph_support: { title: 'Лимфен дренаж', description: 'Сухо четкане и контрастни душове.' },
      stress_resilience: { title: 'Адаптогенна подкрепа', description: 'Адаптогени и дихателни практики.' },
      longevity_protocol: { title: 'Антиейджинг стратегия', description: 'Поддържай антиоксиданти и регенерация.' }
    },
    mandatory_disclaimer: { text: 'Информацията не е медицински съвет.' }
  };

  const config = {
    provider: 'openai',
    report_model: 'gpt-test',
    report_prompt_template: [
      'Потребител: {{USER_DATA}}',
      'Ляво: {{LEFT_EYE_ANALYSIS}}',
      'Дясно: {{RIGHT_EYE_ANALYSIS}}',
      'Интерпретация: {{INTERPRETATION_KNOWLEDGE}}',
      'Препоръки: {{REMEDY_BASE}}',
      'Дисклеймър: {{DISCLAIMER}}'
    ].join('\n')
  };

  try {
    const report = await __testables__.generateHolisticReport(
      {
        name: 'Мария',
        age: '32',
        'main-goals': ['Антиейджинг'],
        'health-status': ['Хипертония'],
        stress: '9'
      },
      leftEyeAnalysis,
      rightEyeAnalysis,
      interpretationKnowledge,
      remedyBase,
      config,
      'test-key'
    );

    assert.equal(report.references.includes('nervine_support'), true);
    assert.equal(report.references.includes('stress_resilience'), true);
    assert.equal(report.references.includes('longevity_protocol'), true);
    assert.equal(report.references.includes('lymph_support'), false);
    assert.match(report.sections.recommendations, /stress_resilience/);

    const usedPrompt = prompts[0];
    assert.ok(usedPrompt.includes('Нервни пръстени'));
    assert.ok(usedPrompt.includes('nervine_support'));
    assert.ok(usedPrompt.includes('Антиейджинг фокус'));
    assert.ok(usedPrompt.includes('longevity_protocol'));
    assert.ok(usedPrompt.includes('Високо ниво на стрес'));
    assert.ok(usedPrompt.includes('stress_resilience'));
    assert.ok(!usedPrompt.includes('lymph_support'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('generateHolisticReport зарежда протокол само от анкетни цели', async () => {
  const originalFetch = global.fetch;
  const prompts = [];

  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.messages[0].content;
    prompts.push(prompt);

    const responsePayload = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: 'Фокус върху тегло',
              references: ['weight_management'],
              sections: {
                weight_management: 'Протоколът е активиран на база целите от анкетата.'
              }
            })
          }
        }
      ]
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const remedyBase = {
    targeted_protocols: {
      weight_management: { title: 'Управление на теглото', description: 'Фокус върху метаболитна подкрепа.' }
    },
    mandatory_disclaimer: { text: 'Информацията не е медицински съвет.' }
  };

  const config = {
    provider: 'openai',
    report_model: 'gpt-test',
    report_prompt_template: [
      'Потребител: {{USER_DATA}}',
      'Препоръки: {{REMEDY_BASE}}'
    ].join('\n')
  };

  try {
    const report = await __testables__.generateHolisticReport(
      {
        name: 'Иван',
        'main-goals': ['Отслабване'],
        'health-status': []
      },
      { identified_signs: [] },
      { identified_signs: [] },
      {},
      remedyBase,
      config,
      'test-key'
    );

    assert.equal(prompts.length, 1);
    assert.ok(prompts[0].includes('weight_management'), 'Очакваме протоколът weight_management да присъства в prompt.');
    assert.equal(report.references.includes('weight_management'), true);
    assert.equal(typeof report.sections.weight_management, 'string');
  } finally {
    global.fetch = originalFetch;
  }
});

test('generateHolisticReport добавя биометрични ключове към prompt (пример 170см/82кг/6ч сън)', async () => {
  const originalFetch = global.fetch;
  const prompts = [];

  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.messages[0].content;
    prompts.push(prompt);

    const responsePayload = {
      choices: [
        {
          message: {
            content: JSON.stringify({ summary: 'OK', references: [], sections: {} })
          }
        }
      ]
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const minimalKnowledge = { scientific_validation_summary: {}, analysis_flow: {} };
  const minimalRemedy = { mandatory_disclaimer: { text: '' } };

  const config = {
    provider: 'openai',
    report_model: 'gpt-test',
    report_prompt_template: 'Пациент: {{USER_DATA}}\nИнтерпретация: {{INTERPRETATION_KNOWLEDGE}}'
  };

  try {
    await __testables__.generateHolisticReport(
      {
        name: 'Ива',
        gender: 'Female',
        height: '170 см',
        weight: '82 кг',
        sleep: '6 часа',
        water: '1.2 L',
        stress: '5',
        'main-goals': ['Антиейджинг', 'Контрол на теглото'],
        'health-status': ['Възстановяване след травма'],
        'free-text': 'Фокус върху възстановяване и енергия.'
      },
      { identified_signs: [] },
      { identified_signs: [] },
      minimalKnowledge,
      minimalRemedy,
      config,
      'key'
    );

    const usedPrompt = prompts[0];
    const expectedSlugs = [
      'bmi_28',
      'наднормено тегло',
      'sleep_6h',
      'hydration_low',
      'женски клиент',
      'weight_management',
      'anti_aging_goal',
      'recovery_focus'
    ];

    for (const slug of expectedSlugs) {
      assert.ok(usedPrompt.includes(slug), `Очаквахме prompt да съдържа ${slug}`);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('generateHolisticReport попълва описателен fallback, когато уеб резултатите липсват', async () => {
  const originalFetch = global.fetch;
  const prompts = [];

  global.fetch = async (url, options) => {
    if (typeof url === 'string' && url.includes('serper.dev')) {
      return new Response(JSON.stringify({ organic: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = JSON.parse(options.body);
    const prompt = body.messages[0].content;
    prompts.push(prompt);

    const responsePayload = {
      choices: [
        {
          message: {
            content: JSON.stringify({ summary: 'Fallback', references: [], sections: {} })
          }
        }
      ]
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const interpretationKnowledge = {
    scientific_validation_summary: 'Лимфната система реагира на хроничен стрес.',
    detox_channels: { summary: 'Подкрепи лимфния дренаж и чернодробна детоксикация.' }
  };

  const remedyBase = {
    targeted_protocols: {
      detox_focus: { title: 'Детокс', description: 'Чай от глухарче и сухо четкане.' }
    },
    mandatory_disclaimer: { text: 'Информацията не е медицински съвет.' }
  };

  const config = {
    provider: 'openai',
    report_model: 'gpt-test',
    report_prompt_template: [
      'Контекст: {{EXTERNAL_CONTEXT}}',
      'Данни: {{USER_DATA}}'
    ].join('\n')
  };

  try {
    await __testables__.generateHolisticReport(
      {
        name: 'Георги',
        age: '45',
        'main-goals': ['Детокс'],
        stress: '7'
      },
      { identified_signs: [{ sign_name: 'Лимфни лакуни' }] },
      { identified_signs: [] },
      interpretationKnowledge,
      remedyBase,
      config,
      'test-key',
      { WEB_RESEARCH_API_KEY: 'dummy', WEB_RESEARCH_ENDPOINT: 'https://serper.dev/search' }
    );

    assert.equal(prompts.length, 1);
    const prompt = prompts[0];
    assert.ok(prompt.includes('LLM synthesis'));
    assert.ok(prompt.includes('Ключови индикатори'));
    assert.ok(prompt.includes('Интерпретация (detox_channels)'));
  } finally {
    global.fetch = originalFetch;
  }
});

// --- Тестове за retry логика и rate limit ---

test('retryWithBackoff успешно изпълнява функция при първи опит', async () => {
  const { retryWithBackoff } = __testables__;
  const mockFn = async () => 'success';
  const result = await retryWithBackoff(mockFn);
  assert.equal(result, 'success');
});

test('retryWithBackoff прави retry при неуспех и връща резултат', async () => {
  const { retryWithBackoff } = __testables__;
  let attempts = 0;
  const mockFn = async () => {
    attempts++;
    if (attempts < 2) {
      throw new Error('Temporary error');
    }
    return 'success after retry';
  };

  const result = await retryWithBackoff(mockFn, 3, 10); // малко забавяне за теста
  assert.equal(result, 'success after retry');
  assert.equal(attempts, 2);
});

test('retryWithBackoff не прави retry при ValidationError', async () => {
  const { retryWithBackoff } = __testables__;

  class ValidationError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ValidationError';
    }
  }

  let attempts = 0;
  const mockFn = async () => {
    attempts++;
    throw new ValidationError('Invalid input');
  };

  await assert.rejects(
    async () => retryWithBackoff(mockFn, 3, 10),
    { name: 'ValidationError' }
  );
  assert.equal(attempts, 1);
});

test('retryWithBackoff хвърля грешка след изчерпване на опитите', async () => {
  const { retryWithBackoff } = __testables__;
  let attempts = 0;
  const mockFn = async () => {
    attempts++;
    throw new Error('Persistent error');
  };

  await assert.rejects(
    async () => retryWithBackoff(mockFn, 2, 10),
    { message: 'Persistent error' }
  );
  assert.equal(attempts, 3); // начален + 2 retry
});

test('analyzeImageWithVision хвърля RateLimitError при 429 отговор', async () => {
  const { analyzeImageWithVision } = __testables__;
  const originalFetch = global.fetch;

  try {
    global.fetch = async () => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({
        error: {
          message: 'Rate limit reached. Please try again in 450ms.',
          type: 'tokens',
          code: 'rate_limit_exceeded'
        }
      }),
      headers: new Map()
    });

    const file = { type: 'image/jpeg', arrayBuffer: async () => new ArrayBuffer(0) };
    const config = {
      provider: 'openai',
      analysis_model: 'gpt-4o',
      analysis_prompt_template: 'Test {{EYE_IDENTIFIER}} {{IRIS_MAP}} {{EXTERNAL_CONTEXT}}'
    };

    await assert.rejects(
      async () => analyzeImageWithVision(file, 'test', {}, config, 'test-key'),
      { name: 'RateLimitError' }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('analyzeImageWithVision логва подробна информация при JSON parse грешка', async () => {
  const { analyzeImageWithVision } = __testables__;
  const originalFetch = global.fetch;
  const consoleLogs = [];
  const originalConsoleError = console.error;

  try {
    console.error = (...args) => consoleLogs.push(args.join(' '));

    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: { content: 'invalid json {' },
          finish_reason: 'stop'
        }]
      })
    });

    const file = { type: 'image/jpeg', arrayBuffer: async () => new ArrayBuffer(0) };
    const config = {
      provider: 'openai',
      analysis_model: 'gpt-4o',
      analysis_prompt_template: 'Test {{EYE_IDENTIFIER}} {{IRIS_MAP}} {{EXTERNAL_CONTEXT}}'
    };

    await assert.rejects(
      async () => analyzeImageWithVision(file, 'test', {}, config, 'test-key'),
      (err) => {
        return err.message.includes('невалиден JSON формат') &&
               err.message.includes('invalid json');
      }
    );

    assert.ok(consoleLogs.some(log => log.includes('Грешка при парсване на JSON')));
    assert.ok(consoleLogs.some(log => log.includes('Получен текст:')));
  } finally {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test('enrichUserDataWithMetrics добавя iris_sign_analysis за по-добро насочване на RAG', () => {
  const userData = {
    name: 'Тест',
    age: 45,
    height: 170,
    weight: 70
  };

  const identifiedSigns = [
    {
      sign_name: 'Нервни пръстени (Contraction Furrows)',
      location: 'Зона 7, периферия',
      intensity: 'силен'
    },
    {
      sign_name: 'Лакуна тип honeycomb',
      location: 'Зона 4, сектор 4:00-5:00 (черен дроб)',
      intensity: 'умерен'
    },
    {
      sign_name: 'Лимфни розети',
      location: 'Зона 6, лимфна зона',
      intensity: 'лек'
    },
    {
      sign_name: 'Scurf Rim',
      location: 'Зона 7, външен ръб',
      intensity: 'умерен'
    }
  ];

  assert.equal(identifiedSigns.length, 4);
  assert.ok(identifiedSigns.some(s => s.sign_name.includes('Нервни пръстени')));
  assert.ok(identifiedSigns.some(s => s.sign_name.includes('Лакуна')));
  assert.ok(identifiedSigns.some(s => s.location.includes('черен дроб')));
});

test('Подобреният analysis_prompt_template съдържа структурирана методология', async () => {
  const fs = await import('fs/promises');
  const configPath = './kv/iris_config_kv.json';
  const configData = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(configData);

  const template = config.analysis_prompt_template;

  // Проверка за наличие на фазите на анализ (използваме актуалния формат от файла)
  assert.ok(template.includes('ФАЗ А 1') || template.includes('ФАЗА 1') || template.includes('КОНСТИТУЦИОНАЛЕН АНАЛИЗ'), 'Трябва да има конституционален анализ');
  assert.ok(template.includes('ФАЗА 2: ТОПОГРАФСКИ АНАЛИЗ') || template.includes('ТОПОГРАФСКИ'), 'Трябва да има топографски анализ');
  assert.ok(template.includes('ФАЗА 3: СЕКТОРЕН АНАЛИЗ') || template.includes('СЕКТОРЕН'), 'Трябва да има секторен анализ');
  assert.ok(template.includes('ФАЗА 4:') || template.includes('ИДЕНТИФИКАЦИЯ НА СПЕЦИФИЧНИ ЗНАЦИ'), 'Трябва да има идентификация на знаци');
  assert.ok(template.includes('ФАЗА 5:') || template.includes('ВАЛИДАЦИЯ'), 'Трябва да има валидация');

  // Проверка за количествени критерии
  assert.ok(template.includes('КОЛИЧЕСТВЕНИ КРИТЕРИИ'), 'Трябва да има секция за количествени критерии');
  assert.ok(template.includes('Брой:'), 'Трябва да изисква брой');
  assert.ok(template.includes('Размер:'), 'Трябва да изисква размер');

  // Проверка за нови полета в JSON структурата
  assert.ok(template.includes('anv_collarette_analysis'), 'Трябва да има анализ на АНВ');
  assert.ok(template.includes('color_characteristics'), 'Трябва да изисква характеристики на цвета');
});

test('max_context_entries е увеличен на 8 за по-богат RAG контекст', async () => {
  const fs = await import('fs/promises');
  const configPath = './kv/iris_config_kv.json';
  const configData = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(configData);

  assert.equal(config.max_context_entries, 8, 'max_context_entries трябва да е 8 за по-добър контекст');
});
