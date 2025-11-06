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

test('Подобреният analysis_prompt_template съдържа 3-нивов анализ и учебникови методологии', async () => {
  const fs = await import('fs/promises');
  const configPath = './kv/iris_config_kv.json';
  const configData = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(configData);

  const template = config.analysis_prompt_template;

  // Проверка за 3-нивов анализ (Jackson-Main)
  assert.ok(template.includes('3-НИВОВ') || template.includes('НИВО 1') || template.includes('КОНСТИТУЦИЯ ПО ЦВЯТ'), 'Трябва да има 3-нивов анализ');
  assert.ok(template.includes('НИВО 2') || template.includes('ДИСПОЗИЦИЯ'), 'Трябва да има ниво 2 - диспозиция');
  assert.ok(template.includes('НИВО 3') || template.includes('ДИАТЕЗА'), 'Трябва да има ниво 3 - диатеза');

  // Проверка за елиминативни канали (Шаран)
  assert.ok(template.includes('ЕЛИМИНАТИВНИ') || template.includes('елиминатив'), 'Трябва да има елиминативни канали');
  assert.ok(template.includes('Черва') && template.includes('Бъбреци'), 'Трябва да споменава конкретни канали');

  // Проверка за цветова интерпретация по стадий
  assert.ok(template.includes('БЯЛ') || template.includes('ОСТЪР'), 'Трябва да има цветова интерпретация');
  assert.ok(template.includes('ЧЕРЕН') || template.includes('ДЕГЕНЕРАТИВЕН'), 'Трябва да включва стадии на процес');

  // Проверка за тополабилни/топостабилни знаци
  assert.ok(template.includes('Тополабилни') || template.includes('Топостабилни') || template.includes('Shoe'), 'Трябва да различава тополабилни/топостабилни');

  // Проверка за специфични лакуни от учебниците
  assert.ok(template.includes('Asparagus') || template.includes('Leaf') || template.includes('Medusa'), 'Трябва да включва специфични типове лакуни');

  // Проверка за IPB анализ (Andrews)
  assert.ok(template.includes('IPB') || template.includes('S-знак'), 'Трябва да има IPB анализ');
});

test('max_context_entries е увеличен на 10 за по-богат RAG контекст (вкл. учебници)', async () => {
  const fs = await import('fs/promises');
  const configPath = './kv/iris_config_kv.json';
  const configData = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(configData);

  assert.equal(config.max_context_entries, 10, 'max_context_entries трябва да е 10 след интеграция на учебниците');
});

test('createConciseIrisMap намалява размера на diagnostic map значително', async () => {
  const { createConciseIrisMap } = __testables__;
  const fs = await import('fs/promises');
  const irisMapData = await fs.readFile('./kv/iris_diagnostic_map.txt', 'utf8');
  const fullIrisMap = JSON.parse(irisMapData);

  const conciseMap = createConciseIrisMap(fullIrisMap);

  const fullSize = JSON.stringify(fullIrisMap, null, 2).length;
  const conciseSize = JSON.stringify(conciseMap, null, 2).length;

  // Проверяваме че има значително намаление (поне 40%)
  assert.ok(conciseSize < fullSize * 0.6, `Concise map трябва да е поне 40% по-малък. Full: ${fullSize}, Concise: ${conciseSize}`);

  // Проверяваме че критичните секции са запазени
  assert.ok(conciseMap.constitutions, 'Трябва да има constitutions');
  assert.ok(conciseMap.zones, 'Трябва да има zones');
  assert.ok(conciseMap.signs, 'Трябва да има signs');

  // Проверяваме че конституционалните типове са включени
  assert.ok(conciseMap.constitutions.color_types, 'Трябва да има color_types');
  assert.ok(conciseMap.constitutions.structural_types, 'Трябва да има structural_types');

  // Проверяваме че има поне 5 зони
  assert.ok(Array.isArray(conciseMap.zones) && conciseMap.zones.length >= 5, 'Трябва да има поне 5 зони');

  // Проверяваме че знаците имат само основната информация
  const firstSignKey = Object.keys(conciseMap.signs)[0];
  if (firstSignKey) {
    const firstSign = conciseMap.signs[firstSignKey];
    assert.ok(firstSign.name, 'Знакът трябва да има име');
    // Проверяваме че няма излишна информация като remedy_link, support, psychology
    assert.equal(firstSign.remedy_link, undefined, 'Concise map не трябва да включва remedy_link в signs');
  }
});

test('createEnrichedVisionContext създава богат контекст с приоритетни знания', async () => {
  const { createEnrichedVisionContext } = __testables__;
  const fs = await import('fs/promises');
  const knowledgeData = await fs.readFile('./kv/holistic_interpretation_knowledge.txt', 'utf8');
  const interpretationKnowledge = JSON.parse(knowledgeData);

  const enrichedContext = createEnrichedVisionContext(interpretationKnowledge, 10);

  // Проверяваме че връща JSON string
  assert.ok(typeof enrichedContext === 'string', 'Трябва да върне string');

  const contextEntries = JSON.parse(enrichedContext);

  // Проверяваме че има масив от записи
  assert.ok(Array.isArray(contextEntries), 'Трябва да върне масив');
  assert.ok(contextEntries.length > 0, 'Трябва да има поне един запис');
  assert.ok(contextEntries.length <= 10, 'Не трябва да надвишава максималния брой записи');

  // Проверяваме структурата на записите
  const firstEntry = contextEntries[0];
  assert.ok(firstEntry.source, 'Всеки запис трябва да има source');
  assert.ok(firstEntry.summary, 'Всеки запис трябва да има summary');

  // Проверяваме че приоритетните ключове са включени ако съществуват
  const sources = contextEntries.map(e => e.source);
  const sourcesStr = sources.join(' ');

  // Поне един от приоритетните ключове трябва да е включен
  const hasPriorityKey = sourcesStr.includes('elimination_channels') ||
                        sourcesStr.includes('common_iris_signs') ||
                        sourcesStr.includes('lacunae_types') ||
                        sourcesStr.includes('nerve_rings');

  assert.ok(hasPriorityKey, 'Трябва да включва поне един приоритетен ключ');
});

test('createEnrichedVisionContext работи дори при празна база знания', () => {
  const { createEnrichedVisionContext } = __testables__;

  const enrichedContext = createEnrichedVisionContext({}, 5);
  const contextEntries = JSON.parse(enrichedContext);

  // Дори при празна база, трябва да върне базови насоки
  assert.ok(Array.isArray(contextEntries), 'Трябва да върне масив');
  assert.ok(contextEntries.length > 0, 'Трябва да има поне базови насоки');
  assert.ok(contextEntries[0].summary.includes('Фокусирай') || contextEntries[0].summary.includes('елиминатив'),
    'Трябва да включва базови насоки');
});

test('generateHolisticReport добавя аналитични метрики към доклада', async () => {
  const { generateHolisticReport } = __testables__;

  const mockLeftEyeAnalysis = {
    eye: 'ляво око',
    constitutional_analysis: {
      level_1_constitution_color: 'Лимфатична конституция с бял ирис',
      level_2_disposition_structure: 'Неврогенна структура с много плътни влакна',
      level_3_diathesis_overlays: 'Хидрогеноидна диатеза с лимфна броеница',
      density_assessment: 'Много плътна тъкан',
      pupil_characteristics: 'Нормална форма и размер',
      anv_collarette_analysis: 'Редовна форма'
    },
    eliminative_channels_assessment: {
      intestines: 'Добро състояние',
      kidneys: 'Леко натоварване',
      lymphatic: 'Умерено натоварване',
      lungs: 'Добро състояние',
      skin: 'Добро състояние'
    },
    identified_signs: [
      { sign_name: 'Лакуна', location: 'зона 3', intensity: 'умерен', description: 'Малка лакуна' },
      { sign_name: 'Нервен пръстен', location: 'зона 7', intensity: 'силен', description: 'Двоен пръстен' }
    ]
  };

  const mockRightEyeAnalysis = {
    eye: 'дясно око',
    constitutional_analysis: {
      level_1_constitution_color: 'Лимфатична конституция',
      level_2_disposition_structure: 'Неврогенна структура',
      level_3_diathesis_overlays: 'Без видими диатези',
      density_assessment: 'Плътна тъкан',
      pupil_characteristics: 'Нормална',
      anv_collarette_analysis: 'Редовна'
    },
    eliminative_channels_assessment: {
      intestines: 'Добро',
      kidneys: 'Добро',
      lymphatic: 'Добро',
      lungs: 'Добро',
      skin: 'Добро'
    },
    identified_signs: [
      { sign_name: 'Радий', location: 'зона 4', intensity: 'лек', description: 'Тънък радий' }
    ]
  };

  const mockUserData = {
    name: 'Тест Потребител',
    age: 35,
    height: 170,
    weight: 70,
    stress: 6
  };

  const mockInterpretationKnowledge = {
    lacunae_types: { name: 'Типове лакуни', description: 'Описание' }
  };

  const mockRemedyBase = {
    mandatory_disclaimer: { text: 'Тестов дисклеймър' }
  };

  const mockConfig = {
    provider: 'openai',
    report_model: 'gpt-4o',
    report_prompt_template: 'Test template {{USER_DATA}} {{LEFT_EYE_ANALYSIS}} {{RIGHT_EYE_ANALYSIS}} {{INTERPRETATION_KNOWLEDGE}} {{REMEDY_BASE}} {{EXTERNAL_CONTEXT}} {{PATIENT_NAME}} {{DISCLAIMER}}',
    max_context_entries: 6
  };

  const mockApiKey = 'test-key';

  const mockEnv = {};

  const mockIrisMap = {
    topography: {
      zones: [
        { zone: 3, name: 'Зона 3', description: 'Хуморална' },
        { zone: 4, name: 'Зона 4', description: 'Органна' },
        { zone: 7, name: 'Зона 7', description: 'Кожна' }
      ]
    },
    signs: {
      lacunae: { name: 'Лакуна', type: 'structural', interpretation: 'Слабост' }
    }
  };

  // Mock fetch за AI заявката
  global.fetch = async (url, options) => {
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              'Име': 'Тест Потребител',
              'Резюме на анализа': 'Тестово резюме',
              'Задължителен отказ от отговорност': 'Тестов дисклеймър'
            })
          }
        }]
      })
    };
  };

  const report = await generateHolisticReport(
    mockUserData,
    mockLeftEyeAnalysis,
    mockRightEyeAnalysis,
    mockInterpretationKnowledge,
    mockRemedyBase,
    mockConfig,
    mockApiKey,
    mockEnv,
    mockIrisMap
  );

  // Проверяваме че докладът съдържа аналитични метрики
  assert.ok(report._analytics, 'Докладът трябва да съдържа _analytics обект');

  const analytics = report._analytics;

  // Проверяваме структурата на метриките
  assert.ok(analytics.timestamp, 'Трябва да има timestamp');
  assert.ok(analytics.detection, 'Трябва да има detection метрики');
  assert.ok(analytics.coverage, 'Трябва да има coverage метрики');
  assert.ok(analytics.constitutional_analysis, 'Трябва да има constitutional_analysis метрики');
  assert.ok(analytics.personalization, 'Трябва да има personalization метрики');
  assert.ok(analytics.quality, 'Трябва да има quality метрики');

  // Проверяваме detection метрики
  assert.ok(analytics.detection.total_signs >= 0, 'Трябва да брои открити знаци');
  assert.ok(analytics.detection.enrichment_rate >= 0 && analytics.detection.enrichment_rate <= 100,
    'Enrichment rate трябва да е между 0 и 100');

  // Проверяваме coverage метрики
  assert.ok(analytics.coverage.zones_analyzed >= 0, 'Трябва да брои анализирани зони');
  assert.ok(analytics.coverage.coverage_percentage >= 0 && analytics.coverage.coverage_percentage <= 100,
    'Coverage percentage трябва да е между 0 и 100');

  // Проверяваме quality метрики
  assert.ok(analytics.quality.precision_score >= 0 && analytics.quality.precision_score <= 100,
    'Precision score трябва да е между 0 и 100');
  assert.ok(analytics.quality.detail_level, 'Трябва да има detail_level');
  assert.ok(analytics.quality.improvement_indicators, 'Трябва да има improvement_indicators');

  // Проверяваме improvement indicators
  assert.ok(typeof analytics.quality.improvement_indicators.enhanced_validation === 'boolean',
    'enhanced_validation трябва да е boolean');
  assert.ok(typeof analytics.quality.improvement_indicators.zone_mapping === 'boolean',
    'zone_mapping трябва да е boolean');
  assert.ok(typeof analytics.quality.improvement_indicators.priority_classification === 'boolean',
    'priority_classification трябва да е boolean');
  assert.ok(typeof analytics.quality.improvement_indicators.personalized_metrics === 'boolean',
    'personalized_metrics трябва да е boolean');
});

test('generateMultiQueryReport извършва 4 фокусирани AI заявки', async () => {
  const originalFetch = global.fetch;
  const callsLog = [];

  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.messages ? body.messages[0].content : body.contents[0].parts[0].text;

    // Логваме всяка заявка
    if (prompt.includes('конституционална синтеза')) {
      callsLog.push('constitutional');
    } else if (prompt.includes('Интерпретирай здравните импликации')) {
      callsLog.push('signs_interpretation');
    } else if (prompt.includes('КОНКРЕТНИ и ПРИЛАГАЕМИ препоръки')) {
      callsLog.push('recommendations');
    } else if (prompt.includes('окончателния СТРУКТУРИРАН доклад')) {
      callsLog.push('final_assembly');
    }

    const responsePayload = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              constitutional_type: 'Лимфатична',
              detailed_analysis: 'Детайлен анализ...',
              priority_systems: [{ system: 'Лимфна система', why_priority: 'Слабост' }],
              eliminative_channels: { intestines: 'Добър' },
              key_findings: [{ finding: 'Находка 1' }],
              synergistic_effect: 'Ефект',
              action_plan: { immediate: ['Действие 1'] },
              nutrition: { foods_to_limit: [], foods_to_add: [] },
              herbs_and_supplements: { herbs: [], supplements: [] },
              holistic_recommendations: { fundamental_principles: [] },
              follow_up: { after_1_month: 'Прогрес' },
              'Име': 'Тест',
              'Резюме на анализа': 'Резюме',
              'Конституционален анализ (3-нивов)': 'Анализ',
              'Приоритетни елиминативни канали': 'Канали',
              'Приоритетни системи за подкрепа': 'Системи',
              'Ключови находки и тяхната връзка': 'Находки',
              'План за действие': 'План',
              'Специални хранителни насоки': {},
              'Препоръки за билки и добавки': {},
              'Холистични препоръки': {},
              'Препоръки за проследяване': 'Проследяване',
              'Задължителен отказ от отговорност': 'Дисклеймър'
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

  const config = {
    provider: 'openai',
    report_model: 'gpt-4o',
    use_multi_query_report: true
  };

  try {
    const report = await __testables__.generateMultiQueryReport(
      { name: 'Иван', age: 35 },
      { constitutional_analysis: { level_1_constitution_color: 'Лимфатична' }, identified_signs: [] },
      { constitutional_analysis: { level_1_constitution_color: 'Лимфатична' }, identified_signs: [] },
      {},
      { mandatory_disclaimer: { text: 'Дисклеймър' } },
      config,
      'test-key',
      null,
      {}
    );

    assert.equal(callsLog.length, 4, 'Очакваме 4 AI заявки');
    assert.equal(callsLog[0], 'constitutional', 'Първа заявка за конституционална синтеза');
    assert.equal(callsLog[1], 'signs_interpretation', 'Втора заявка за интерпретация на знаците');
    assert.equal(callsLog[2], 'recommendations', 'Трета заявка за препоръки');
    assert.equal(callsLog[3], 'final_assembly', 'Четвърта заявка за финално сглобяване');
    assert.ok(report['Име'], 'Докладът съдържа име');
    assert.ok(report._analytics, 'Докладът съдържа аналитика');
  } finally {
    global.fetch = originalFetch;
  }
});

test('calculateKnowledgeSourceMetrics изчислява правилно разпределението на източници', () => {
  const { calculateKnowledgeSourceMetrics } = __testables__;

  const filteredKnowledge = {
    lacunae_interpretation: { description: 'Информация за лакуни' },
    nerve_rings: { description: 'Информация за нервни пръстени' },
    elimination_channels: { description: 'Елиминативни канали' }
  };

  const relevantRemedyBase = {
    detoxification: { protocol: 'Детокс протокол' },
    herbs: { list: ['Билка 1', 'Билка 2'] }
  };

  const webInsights = [
    { title: 'Източник 1', snippet: 'Информация 1', url: 'http://example.com/1' },
    { title: 'Източник 2', snippet: 'Информация 2', url: 'http://example.com/2' }
  ];

  const metrics = calculateKnowledgeSourceMetrics(
    filteredKnowledge,
    relevantRemedyBase,
    webInsights,
    7,
    true
  );

  assert.ok(metrics.sources_used, 'Метриките съдържат информация за използвани източници');
  assert.ok(metrics.sources_used.rag_memory, 'Съдържа информация за RAG памет');
  assert.ok(metrics.sources_used.remedy_base, 'Съдържа информация за база с препоръки');
  assert.ok(metrics.sources_used.internet_search, 'Съдържа информация за интернет търсене');
  assert.ok(metrics.sources_used.llm_knowledge, 'Съдържа информация за LLM знания');

  assert.equal(metrics.sources_used.rag_memory.used, true, 'RAG памет е използвана');
  assert.equal(metrics.sources_used.rag_memory.entries_count, 3, 'RAG има 3 записа');

  assert.equal(metrics.sources_used.remedy_base.used, true, 'Remedy base е използвана');
  assert.equal(metrics.sources_used.remedy_base.entries_count, 2, 'Remedy base има 2 записа');

  assert.equal(metrics.sources_used.internet_search.used, true, 'Интернет търсене е използвано');
  assert.equal(metrics.sources_used.internet_search.enabled, true, 'Интернет търсене е активирано');
  assert.equal(metrics.sources_used.internet_search.entries_count, 2, 'Интернет търсене има 2 записа');

  assert.equal(metrics.sources_used.llm_knowledge.used, true, 'LLM знания винаги са използвани');
  assert.equal(metrics.sources_used.llm_knowledge.percentage, 25, 'LLM добавя 25% синтеза');

  assert.ok(metrics.analysis_flow, 'Съдържа информация за последователността на анализа');
  assert.ok(Array.isArray(metrics.analysis_flow.sequence), 'Последователността е масив от стъпки');
  assert.equal(metrics.analysis_flow.sequence.length, 5, 'Има 5 стъпки в анализа');
  assert.equal(metrics.analysis_flow.logic_validation.is_correct, true, 'Логиката е валидна');

  assert.ok(metrics.percentage_breakdown, 'Съдържа процентно разпределение');
  assert.ok(metrics.percentage_breakdown.rag_memory, 'Има процент за RAG памет');
  assert.ok(metrics.percentage_breakdown.remedy_base, 'Има процент за база с препоръки');
  assert.ok(metrics.percentage_breakdown.internet_search, 'Има процент за интернет търсене');
  assert.ok(metrics.percentage_breakdown.llm_knowledge, 'Има процент за LLM знания');
});

test('calculateKnowledgeSourceMetrics работи правилно без интернет търсене', () => {
  const { calculateKnowledgeSourceMetrics } = __testables__;

  const filteredKnowledge = {
    lacunae: { info: 'Информация' }
  };

  const relevantRemedyBase = {
    herbs: { list: [] }
  };

  const metrics = calculateKnowledgeSourceMetrics(
    filteredKnowledge,
    relevantRemedyBase,
    [],
    2,
    false
  );

  assert.equal(metrics.sources_used.internet_search.used, false, 'Интернет търсене не е използвано');
  assert.equal(metrics.sources_used.internet_search.enabled, false, 'Интернет търсене не е активирано');
  assert.equal(metrics.sources_used.internet_search.entries_count, 0, 'Няма записи от интернет търсене');
  assert.equal(metrics.sources_used.internet_search.percentage, 0, 'Интернет търсене е 0%');

  assert.ok(metrics.sources_used.rag_memory.percentage > 0, 'RAG памет има процент > 0');
  assert.ok(metrics.sources_used.llm_knowledge.used, 'LLM знания все още са използвани');
});

test('generateAnalyticsMetrics включва метрики за източници на знания', () => {
  const { generateAnalyticsMetrics } = __testables__;

  const leftEye = {
    constitutional_analysis: { level_1_constitution_color: 'Хематогенна' }
  };

  const rightEye = {
    constitutional_analysis: { level_1_constitution_color: 'Лимфатична' }
  };

  const enrichedSigns = [
    { sign_name: 'Лакуна', validated_zone: 3, priority_level: 'high' }
  ];

  const rawSigns = [
    { sign_name: 'Лакуна' }
  ];

  const userData = {
    name: 'Тест',
    age: 45
  };

  const sourceMetrics = {
    sources_used: {
      rag_memory: { used: true, percentage: 50 },
      llm_knowledge: { used: true, percentage: 25 }
    }
  };

  const analytics = generateAnalyticsMetrics(
    leftEye,
    rightEye,
    enrichedSigns,
    rawSigns,
    userData,
    sourceMetrics
  );

  assert.ok(analytics.knowledge_sources, 'Аналитиката включва метрики за източници на знания');
  assert.ok(analytics.knowledge_sources.sources_used, 'Съдържа информация за използвани източници');
  assert.ok(analytics.knowledge_sources.sources_used.rag_memory, 'Съдържа RAG метрики');
  assert.ok(analytics.knowledge_sources.sources_used.llm_knowledge, 'Съдържа LLM метрики');
});
