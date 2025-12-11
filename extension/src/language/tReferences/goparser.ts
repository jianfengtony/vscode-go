import * as vscode from 'vscode';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

class DeclInfo {
	type: string
	start: number;
	end: number;
	name: string | undefined;

	constructor(type: string, start: number, end: number) {
		this.type = type
		this.start = start
		this.end = end
	}

	getDescription(): string {
		let des = this.type!;
		if (this.name) {
			des += `: ${this.name}`;
		}
		return des;
	}
}

class SrcInfo {
	path: string;
	package: string | undefined;
	decls: DeclInfo[] = [];

	constructor(path: string) {
		this.path = path;
	}

	addDecl(decl: DeclInfo) {
		this.decls.push(decl);
	}

	queryDecl(line: number): DeclInfo | undefined {
		return this.decls.find((decl) => decl.start <= line && line <= decl.end);
	}
}

export namespace GoParser {
	const extensionPath = vscode.extensions.getExtension('golang.go')!.extensionPath;
	const binPath = path.join(extensionPath, 'bin');
	const srcPath = path.join(extensionPath, 'media', 'gosrcparser.go');
	var exePath: string | undefined;

	const srcCache = new Map<string, SrcInfo>();
	const srcCacheKeys: string[] = [];

	export function init() {
		let goversion = execSync('go version').toString().trim();
		let major: string | undefined;

		if (goversion) {
			let match = goversion.match(/go1.\d{2}/);
			major = match?.at(0)
		}
		if (goversion && major) {
			exePath = path.join(binPath, `gosrcparser-${major}.exe`);
		} else {
			vscode.window.showErrorMessage('Go not installed.');
			return;
		}

		if (fs.existsSync(exePath)) {
			return;
		}

		try {
			execSync(`go build -o "${exePath}" "${srcPath}"`);
		} catch (error) {
			vscode.window.showErrorMessage('Failed to build Go parser.');
		}
	}

	export function getSrcInfo(path: string): SrcInfo | undefined {
		if (srcCache.has(path)) {
			return srcCache.get(path)!;
		}
		let srcInfo = parseSrc(path);
		if (!srcInfo) {
			return undefined;
		}
		srcCache.set(path, srcInfo);
		srcCacheKeys.push(path);
		if (srcCacheKeys.length > 50) {
			let oldestKey = srcCacheKeys.shift()!;
			srcCache.delete(oldestKey);
		}
		return srcInfo;
	}

	export function fileChanged(doc: vscode.TextDocument) {
		srcCache.delete(doc.fileName)
	}

	function parseSrc(path: string): SrcInfo | undefined {
		try {
			let srcInfo = new SrcInfo(path);
			let lines = execSync(`${exePath} -src ${path}`).toString().trim().split('\n')
			for (let i = 0; i < lines.length; i++) {
				let line = lines[i];
				if (i === 0) {
					if (line === "T202512120116") {
						continue;
					} else {
						throw new Error("Invalid Go parser output");
					}
				}

				let parts = line.split(',');
				if (parts.length == 2) {
					srcInfo.package = parts[1];
					continue;
				} else if (parts.length >= 3) {
					let type = parts[0];
					let start = parseInt(parts[1]);
					let end = parseInt(parts[2]);
					let decl = new DeclInfo(type, start - 1, end - 1)
					if (parts.length >= 4) {
						decl.name = parts[3];
					}
					srcInfo.addDecl(decl);
				}
			}
			return srcInfo;
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to parse Go source file: ${path}`);
			return undefined;
		}
	}
}