import { handleSrsGrade } from "@/server/srs";
import { runSrsRoute } from "@/server/srs-route";

export const dynamic = "force-dynamic";

/** POST /api/srs/grade { wordId, grade: 'again'|'hard'|'good' } -> { card, firstStudy } */
export function POST(request: Request) {
  return runSrsRoute(request, handleSrsGrade);
}
