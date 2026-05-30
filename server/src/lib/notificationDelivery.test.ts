import assert from 'node:assert/strict';
import test from 'node:test';

const { getBusinessNotificationActionPath } = await import('./notificationDelivery.js');

test('notification action paths target exact detail areas', () => {
  assert.equal(
    getBusinessNotificationActionPath({ type: 'ticket', audience: 'user', relatedId: 'ticket-1' }),
    '/my-tickets/ticket-1#messages',
  );
  assert.equal(
    getBusinessNotificationActionPath({ type: 'ticket', audience: 'admin', relatedId: 'ticket-1' }),
    '/admin/tickets/ticket-1#messages',
  );
  assert.equal(
    getBusinessNotificationActionPath({ type: 'inquiry', audience: 'user', relatedId: 'inquiry-1' }),
    '/my-inquiries/inquiry-1#messages',
  );
  assert.equal(
    getBusinessNotificationActionPath({ type: 'backup', audience: 'admin', relatedId: 'backup-policy:high' }),
    '/admin/settings#backup',
  );
  assert.equal(
    getBusinessNotificationActionPath({ type: 'model_conversion', audience: 'user', relatedId: 'model-1' }),
    '/model/model-1',
  );
});
