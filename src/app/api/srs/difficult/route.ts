import { handleSrsDifficult } from "@/server/srs";
import { runSrsRoute } from "@/server/srs-route";

export const dynamic = "force-dynamic";

/** POST /api/srs/difficult { wordId, value } -> { wordId, isDifficult } */
export function POST(request: Request) {
  return runSrsRoute(request, handleSrsDifficult);
}
