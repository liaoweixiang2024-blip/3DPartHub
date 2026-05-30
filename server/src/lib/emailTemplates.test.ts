import assert from 'node:assert/strict';
import test from 'node:test';

const { DEFAULT_EMAIL_TEMPLATES, parseEmailTemplates } = await import('./emailTemplates.js');

test('default email templates expose action link tokens', () => {
  for (const template of Object.values(DEFAULT_EMAIL_TEMPLATES)) {
    assert.ok(template.tokens.includes('actionUrl'));
    assert.ok(template.tokens.includes('actionLabel'));
    assert.ok(template.html.includes('{{actionUrl}}'));
  }
});

test('legacy saved email shell links are upgraded to notification action links', () => {
  const legacyHtml = [
    '<a href="{{siteUrl}}" style="display:inline-flex;align-items:center;">{{siteTitle}}</a>',
    '<div><a href="{{siteUrl}}" style="color:#f97316;text-decoration:none;">{{siteUrl}}</a></div>',
  ].join('\n');
  const templates = parseEmailTemplates({
    smtp_test: {
      label: '旧测试模板',
      html: legacyHtml,
      tokens: ['siteUrl'],
    },
  });

  assert.ok(templates.smtp_test.html.includes('href="{{actionUrl}}"'));
  assert.ok(templates.smtp_test.html.includes('{{actionLabel}}'));
  assert.ok(templates.smtp_test.tokens.includes('actionUrl'));
  assert.ok(templates.smtp_test.tokens.includes('actionLabel'));
});
