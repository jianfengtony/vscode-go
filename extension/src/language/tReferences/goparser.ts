import * as vscode from 'vscode';
import { execSync } from 'child_process';
import path from 'path';

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
	const parserPath = path.join(extensionPath, 'media', 'gosrcparser');
	const srcPath = path.join(parserPath, 'main.go');
	const exePath = path.join(parserPath, 'gosrcparser.exe');

	const srcCache = new Map<string, SrcInfo>();

	export function init() {
		try {
			execSync(`go build -o "${exePath}" "${srcPath}"`);
			console.log('Go source parser built at', exePath);
		} catch (error) {
			console.error('Failed to build Go source parser:', error);
		}
	}

	export function getSrcInfo(path: string): SrcInfo {
		if (srcCache.has(path)) {
			return srcCache.get(path)!;
		}
		let srcInfo = parseSrc(path);
		srcCache.set(path, srcInfo);
		return srcInfo;
	}

	export function fileChanged(path: string) {
		srcCache.delete(path)
	}

	function parseSrc(path: string): SrcInfo {
		let srcInfo = new SrcInfo(path);
		execSync(`${exePath} -src ${path}`).toString().trim().split('\n')
			.forEach((line, index) => {
				if (index === 0) {
					srcInfo.package = line.trim();
					return
				}

				let parts = line.split(',');
				if (parts.length >= 3) {
					let type = parts[0];
					let start = parseInt(parts[1]);
					let end = parseInt(parts[2]);
					let decl = new DeclInfo(type, start - 1, end - 1)
					if (parts.length >= 4) {
						decl.name = parts[3];
					}
					srcInfo.addDecl(decl);
				}
			});
		return srcInfo;
	}
}