-- Update retired Gemini default models (2.0 shut down; 2.5 blocked for new keys).
UPDATE public.ai_providers
SET default_model = 'gemini-3.5-flash'
WHERE code = 'gemini' AND default_model IN (
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-lite-001',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
);