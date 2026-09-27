-- M1 · Core helper functions (identity-independent)
-- Spec: Phase 3 Part 1 §7, Part 5 §1
-- Business-membership helpers (has_business_role, my_business_ids, my_staff_id, my_staff_ids)
-- reference M2 tables and are created in M2.

-- ─── Caller identity ───────────────────────────────────────────────────────
-- Deviation (logged): Phase 3 Part 1 §7 wrote private.uid() as `select auth.uid()`.
-- Functions owned by app_owner can't use the auth schema: the migration role has no grant
-- option on it. These read the same request GUCs that auth.uid()/auth.jwt() read, so the
-- behavior is identical. Every SECURITY DEFINER function must use private.jwt()/private.uid().
create function private.jwt() returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create function private.uid() returns uuid
language sql stable set search_path = '' as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    private.jwt() ->> 'sub'
  )::uuid
$$;

create function private.is_anonymous() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((private.jwt() ->> 'is_anonymous')::boolean, false)
$$;

-- ─── Phone normalization (Lebanon-aware) ───────────────────────────────────
-- Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits → ASCII
create function private.normalize_digits(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select translate(p, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')
$$;

-- Returns E.164 (+9613123456) or null when the input can't be a valid number.
-- Accepts: +961 3 123 456 · 00961 3 123456 · 03 123 456 · 3123456 · 70123456 · +33 6 12 34 56 78
create function private.normalize_phone(p_raw text, p_default_cc text default '961') returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare
  d text := regexp_replace(private.normalize_digits(coalesce(p_raw, '')), '[^0-9+]', '', 'g');
begin
  if d like '+%' then
    d := substr(d, 2);
  elsif d like '00%' then
    d := substr(d, 3);
  elsif d like '0%' then
    d := p_default_cc || substr(d, 2);           -- 03 123456 → 9613123456
  elsif length(d) between 7 and 8 then
    d := p_default_cc || d;                      -- 3123456 / 70123456
  end if;
  if d !~ '^[1-9][0-9]{7,14}$' then
    return null;
  end if;
  return '+' || d;
end $$;

-- ─── Search normalization (Part 5 §1) ──────────────────────────────────────
-- unaccent with an explicit dictionary is deterministic, so the wrapper can be IMMUTABLE
-- (required for generated columns and expression indexes).
create function private.normalize_text(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(
           regexp_replace(
             translate(
               lower(extensions.unaccent('extensions.unaccent'::regdictionary,
                                         private.normalize_digits(coalesce(p, '')))),
               'أإآٱىةؤئ', 'اااايهوي'),               -- alef forms→ا, ى→ي, ة→ه, ؤ→و, ئ→ي
             '[ً-ْٰـ]', '', 'g'),   -- harakat, dagger alef, tatweel
           '\s+', ' ', 'g'))
$$;

-- Arabizi folding for Latin tokens: 7'→kh, 3'→gh, then 2→'' 3→a 5→kh 6→t 7→h 8→gh 9→q,
-- and collapse repeated letters. Arabic-script tokens are left untouched.
-- "7ala2" → "hala" · "m3allim" → "malim" · "mekkyaj" → "mekyaj"
create function private.arabizi_fold(p text) returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare
  tok text;
  result text := '';
begin
  if p is null then
    return null;
  end if;
  foreach tok in array regexp_split_to_array(p, '\s+') loop
    if tok ~ '[a-z]' then
      if tok ~ '[0-9]' then
        tok := replace(tok, '7''', 'kh');
        tok := replace(tok, '3''', 'gh');
        tok := replace(tok, '2', '');
        tok := replace(tok, '3', 'a');
        tok := replace(tok, '5', 'kh');
        tok := replace(tok, '6', 't');
        tok := replace(tok, '7', 'h');
        tok := replace(tok, '8', 'gh');
        tok := replace(tok, '9', 'q');
      end if;
      tok := regexp_replace(tok, '([a-z])\1+', '\1', 'g');
    end if;
    if tok <> '' then
      result := case when result = '' then tok else result || ' ' || tok end;
    end if;
  end loop;
  return result;
end $$;

-- The key used for every search comparison (synonyms, aliases, search documents, queries)
create function private.search_key(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select private.arabizi_fold(private.normalize_text(p))
$$;

-- Helpers used inside RLS policies must be executable by client roles.
grant execute on function private.jwt()          to anon, authenticated;
grant execute on function private.uid()          to anon, authenticated;
grant execute on function private.is_anonymous() to anon, authenticated;
-- Pure functions are safe for everyone (used by generated columns and search RPCs).
grant execute on function private.normalize_digits(text)      to anon, authenticated;
grant execute on function private.normalize_phone(text, text) to anon, authenticated;
grant execute on function private.normalize_text(text)        to anon, authenticated;
grant execute on function private.arabizi_fold(text)          to anon, authenticated;
grant execute on function private.search_key(text)            to anon, authenticated;

select private.assign_app_ownership();
