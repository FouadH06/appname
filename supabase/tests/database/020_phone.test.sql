-- Phase 3 Part 1 §7 — Lebanon-aware phone normalization
begin;
create extension if not exists pgtap with schema extensions;
-- Hosted sessions (CLI login role) do not have extensions on search_path; be explicit.
set local search_path = extensions, public;
-- Run as postgres everywhere (hosted CLI connects as a temporary login role).
set local role postgres;
select plan(16);

select is(private.normalize_phone('03 123 456'),        '+9613123456',   'local mobile with leading 0');
select is(private.normalize_phone('3123456'),           '+9613123456',   '7-digit mobile without 0');
select is(private.normalize_phone('70123456'),          '+96170123456',  '8-digit mobile (70)');
select is(private.normalize_phone('71-123-456'),        '+96171123456',  'dashes stripped');
select is(private.normalize_phone('76 123 456'),        '+96176123456',  '76 prefix');
select is(private.normalize_phone('81 123 456'),        '+96181123456',  '81 prefix');
select is(private.normalize_phone('+961 70 123 456'),   '+96170123456',  'international format');
select is(private.normalize_phone('00961 70 123 456'),  '+96170123456',  '00 international prefix');
select is(private.normalize_phone('01 234 567'),        '+9611234567',   'Beirut landline');
select is(private.normalize_phone('٠٣١٢٣٤٥٦'),          '+9613123456',   'Arabic-Indic digits');
select is(private.normalize_phone('۰۷۰۱۲۳۴۵۶'),         '+96170123456',  'Extended Arabic-Indic digits');
select is(private.normalize_phone('+33 6 12 34 56 78'), '+33612345678',  'foreign number (diaspora)');
select is(private.normalize_phone('abc'),               null,            'letters only → null');
select is(private.normalize_phone(''),                  null,            'empty → null');
select is(private.normalize_phone('123'),               null,            'too short → null');
select is(private.normalize_digits('٠١٢٣٤٥٦٧٨٩'),      '0123456789',    'normalize_digits');

select * from finish();
rollback;
