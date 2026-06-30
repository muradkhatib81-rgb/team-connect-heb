import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { attachActiveBranch } from "@/integrations/supabase/active-branch";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  // Order: auth attaches Authorization first, then active-branch appends
  // X-Active-Branch. TanStack merges headers across function middlewares.
  functionMiddleware: [attachSupabaseAuth, attachActiveBranch],
  requestMiddleware: [errorMiddleware],
}));
