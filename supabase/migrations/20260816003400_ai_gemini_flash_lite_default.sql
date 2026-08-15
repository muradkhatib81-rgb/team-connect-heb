-- Faster chat default: Gemini 3.5 Flash-Lite (minimal thinking, lower latency).
UPDATE public.ai_providers
SET default_model = 'gemini-3.5-flash-lite'
WHERE code = 'gemini';
