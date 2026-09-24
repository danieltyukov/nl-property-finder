import { expect, test } from 'vitest';
import { evaluateRequirements } from '../src/filters.js';
import { profile, search } from './helpers.js';

const s = search();
const now = new Date('2026-09-23T10:00:00Z');

test('income 2800 with multiple 4 and rent 900 fails without guarantor, passes with guarantor income 5000', () => {
  const req = { incomeMultiple: 4 };
  expect(evaluateRequirements(req, profile({ incomeMonthlyGrossEur: 2800 }), s, { rentEur: 900 })).toEqual({
    passed: false, failedRule: 'income 2800 < 3600 (4x rent)',
  });
  const withGuarantor = profile({ incomeMonthlyGrossEur: 2800, guarantor: { relation: 'parent', incomeMonthlyGrossEur: 5000 } });
  expect(evaluateRequirements(req, withGuarantor, s, { rentEur: 900 })).toEqual({ passed: true });
  expect(evaluateRequirements({ ...req, guarantorAccepted: false }, withGuarantor, s, { rentEur: 900 }).passed).toBe(false);
});

test('co-applicant incomes add up', () => {
  const p = profile({ incomeMonthlyGrossEur: 2000, coApplicants: [{ name: 'Alex', relation: 'partner', incomeMonthlyGrossEur: 1800 }] });
  expect(evaluateRequirements({ incomeMultiple: 4 }, p, s, { rentEur: 900 }).passed).toBe(true);
  expect(evaluateRequirements({ minIncomeEur: 4000 }, p, s).passed).toBe(false);
});

test('unknown income is not held against the person', () => {
  expect(evaluateRequirements({ incomeMultiple: 4 }, profile(), s, { rentEur: 900 }).passed).toBe(true);
});

test('registration, students, pets, smoking', () => {
  expect(evaluateRequirements({ registrationAllowed: false }, profile(), search({ requireRegistration: true }))).toEqual({
    passed: false, failedRule: 'registration not allowed',
  });
  expect(evaluateRequirements({ registrationAllowed: false }, profile(), search({ requireRegistration: false })).passed).toBe(true);
  expect(evaluateRequirements({ studentsAllowed: false }, profile({ occupation: 'student' }), s)).toEqual({ passed: false, failedRule: 'no students' });
  expect(evaluateRequirements({ studentsAllowed: false }, profile({ occupation: 'employed' }), s).passed).toBe(true);
  expect(evaluateRequirements({ petsAllowed: false }, profile({ household: { adults: 1, children: 0, pets: true } }), s)).toEqual({
    passed: false, failedRule: 'no pets',
  });
  expect(evaluateRequirements({ smokingAllowed: false }, profile({ smoker: true }), s)).toEqual({ passed: false, failedRule: 'no smokers' });
});

test('house sharing and household size', () => {
  const friends = profile({ coApplicants: [{ name: 'Kim', relation: 'friend' }] });
  expect(evaluateRequirements({ sharingAllowed: false }, friends, s)).toEqual({ passed: false, failedRule: 'no house sharing' });
  const couple = profile({ coApplicants: [{ name: 'Alex', relation: 'partner' }] });
  expect(evaluateRequirements({ sharingAllowed: false }, couple, s).passed).toBe(true);
});

test('age limits allow for an unknown birthday', () => {
  const p = profile({ birthYear: 2000 }); // 25 or 26 in September 2026
  expect(evaluateRequirements({ ageMax: 25 }, p, s, { now }).passed).toBe(true);
  expect(evaluateRequirements({ ageMax: 24 }, p, s, { now })).toEqual({ passed: false, failedRule: 'age above 24' });
  expect(evaluateRequirements({ ageMin: 27 }, p, s, { now })).toEqual({ passed: false, failedRule: 'age below 27' });
});

test('contract length against the planned stay', () => {
  expect(evaluateRequirements({ minMonths: 12 }, profile({ stayMonths: 6 }), s)).toEqual({ passed: false, failedRule: 'minimum stay 12 months' });
  expect(evaluateRequirements({ maxMonths: 6 }, profile({ stayMonths: 12 }), s)).toEqual({ passed: false, failedRule: 'maximum stay 6 months' });
});
