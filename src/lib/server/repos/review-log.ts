import { eq } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { reviewLog, type NewReviewLogRow, type ReviewLogRow } from '../db/schema.ts';

// The log is append-only: there is no update or delete.
export function insertReviewLog(x: Executor, row: NewReviewLogRow): void {
	x.insert(reviewLog).values(row).run();
}

export function getReviewLog(x: Executor, id: string): ReviewLogRow | undefined {
	return x.select().from(reviewLog).where(eq(reviewLog.id, id)).get();
}
