import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    csrfToken?: string;
    flash?: {
      type: "success" | "error" | "info";
      message: string;
    };
    captchaChallenges?: Record<
      string,
      {
        solutionX: number;
        targetY: number;
        expiresAt: number;
        used: boolean;
      }
    >;
  }
}
