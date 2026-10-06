import { clerkMiddleware } from '@clerk/nextjs/server';

export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals, static files, and the simulation APIs.
    // Those APIs are called by the courtroom on another origin with a launch
    // token. Clerk must not answer them, or the browser treats the reply as a
    // CORS failure.
    '/((?!_next|api/simulations|api/classroom|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
  ],
};