import { createServer, type AddressInfo } from 'node:net';

// A port that nothing on this machine is listening on right now, for a throwaway server.
export function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo;
			server.close(() => resolve(port));
		});
		server.on('error', reject);
	});
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
