// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Locals {
			requestId: string;
		}
		// Handed to the next page through goto: the Trash page says which deck was just moved there.
		interface PageState {
			moved?: string;
		}
	}
}

export {};
