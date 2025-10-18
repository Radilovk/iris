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
              references: ['nervine_support'],
              sections: {
                recommendations: 'Препоръките стъпват върху nervine_support и включват нервно балансиране.'
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

  const remedyBase = {
    foundational_principles: { title: 'Основи', principles: [] },
    targeted_protocols: {
      nervine_support: { title: 'Нервно успокояване', description: 'Използвай магнезий и адаптогени.' },
      lymph_support: { title: 'Лимфен дренаж', description: 'Сухо четкане и контрастни душове.' }
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
      { name: 'Мария', age: '32' },
      leftEyeAnalysis,
      rightEyeAnalysis,
      interpretationKnowledge,
      remedyBase,
      config,
      'test-key'
    );

    assert.equal(report.references.includes('nervine_support'), true);
    assert.equal(report.references.includes('lymph_support'), false);
    assert.match(report.sections.recommendations, /nervine_support/);

    const usedPrompt = prompts[0];
    assert.ok(usedPrompt.includes('Нервни пръстени'));
    assert.ok(usedPrompt.includes('nervine_support'));
    assert.ok(!usedPrompt.includes('lymph_support'));
  } finally {
    global.fetch = originalFetch;
  }
});
