import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, templateVars, formatAmount } from '../src/core/templates.js';

test('sostituisce i segnaposto e lascia intatti quelli sconosciuti', () => {
  assert.equal(render('{user} ha donato {amount} {boh}', { user: 'Anna', amount: 5 }), 'Anna ha donato 5 {boh}');
});

test('gestisce il plurale', () => {
  const t = '{amount} spettator{amount|e|i}';
  assert.equal(render(t, { amount: 1 }), '1 spettatore');
  assert.equal(render(t, { amount: 12 }), '12 spettatori');
});

test('formatta le valute in italiano', () => {
  assert.equal(formatAmount(5, 'EUR'), '5,00 €');
  assert.equal(formatAmount(3, 'XYZ1'), '3 XYZ1');
});

test('utente anonimo', () => {
  assert.equal(templateVars({ user: null }).user, 'Anonimo');
});
