-- Gemini 2.5+ models are blocked for new API keys — use Gemini 3.5 GA defaults.
UPDATE public.ai_providers
SET default_model = 'gemini-3.5-flash'
WHERE code = 'gemini';
