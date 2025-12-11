import * as vscode from 'vscode';
import { GoParser } from './goparser';
import path from 'path';

export const itemClickCommand = 'go.RefencesItemClick';

const mediaPath = vscode.extensions.getExtension('golang.go')!.extensionPath + '/media/';

export class TreeLeaf extends vscode.TreeItem {
	private location: vscode.Location
	parent: TreeContainer | null = null;

	constructor(location: vscode.Location) {
		let label = `line: ${location.range.start.line + 1}:${location.range.start.character + 1}`;
		super(label, vscode.TreeItemCollapsibleState.None)
		this.location = location
		this.command = {
			command: itemClickCommand,
			title: 'Item Click',
			arguments: [location]
		}
	}

	public async resolve(): Promise<TreeLeaf> {
		const doc = await vscode.workspace.openTextDocument(this.location.uri);
		const rawLine = doc.lineAt(this.location.range.start.line).text;
		const trimmedStart = rawLine.trimStart();
		const leading = rawLine.length - trimmedStart.length;
		const start = this.location.range.start.character - leading;
		const end = this.location.range.end.character - leading;
		this.label = {
			label: trimmedStart.trimEnd(),
			highlights: [[start, end]]
		} as vscode.TreeItemLabel;
		this.iconPath = vscode.Uri.file(mediaPath + '/go-logo-white.svg');
		return this;
	}
}

export class TreeContainer extends vscode.TreeItem {
	private children: vscode.TreeItem[];
	parent: TreeContainer | null = null;

	constructor(label: string = "Unclassified") {
		super(label, vscode.TreeItemCollapsibleState.Expanded);
		this.children = []
	}

	private getLeafCount(): number {
		let count = 0;
		this.children.forEach((child) => {
			if (child instanceof TreeContainer) {
				count += child.getLeafCount();
			} else {
				count += 1;
			}
		});
		return count;
	}

	public resolve(): TreeContainer {
		let leafCount = this.getLeafCount();
		if (leafCount <= 1) {
			this.description = `${leafCount} result`
		} else {
			this.description = `${leafCount} results`
		}
		return this;
	}

	public getChildren(): vscode.TreeItem[] {
		return this.children
	}

	private getOrCreateDirContainer(loc: vscode.Location): TreeContainer {
		let dir = path.parse(loc.uri.fsPath).dir
		let workspaceFolder = vscode.workspace.getWorkspaceFolder(loc.uri);
		if (workspaceFolder) {
			dir = dir.substring(workspaceFolder.uri.fsPath.length + 1);
		}
		if (!dir) {
			return this
		}
		const existing = this.children.find((child) => child.label === dir)
		if (existing && existing instanceof TreeContainer) {
			return existing
		}
		const container = new TreeContainer(dir)
		container.parent = this;
		this.children.push(container)
		return container
	}

	private getOrCreateFileContainer(loc: vscode.Location): TreeContainer {
		let file = path.parse(loc.uri.fsPath).base
		const existing = this.children.find((child) => child.label === file)
		if (existing && existing instanceof TreeContainer) {
			return existing
		}
		const container = new TreeContainer(file)
		container.parent = this;
		container.iconPath = vscode.Uri.file(mediaPath + '/go-logo-blue.png');
		this.children.push(container)
		return container
	}

	private getOrCreateScopeContainer(scope: string): TreeContainer {
		let parts = scope.split(':');
		let type = parts[0].trim();
		let name = parts[1].trim();

		const existing = this.children.find((child) => child.label === name)
		if (existing && existing instanceof TreeContainer) {
			return existing
		}

		const container = new TreeContainer(name.trim())
		container.parent = this;
		switch (type) {
			case "Function":
				container.iconPath = vscode.Uri.file(mediaPath + '/icon_function.png');
				break;
			case "Method":
				container.iconPath = vscode.Uri.file(mediaPath + '/icon_method.png');
				break;
			case "Type":
				container.iconPath = vscode.Uri.file(mediaPath + '/icon_type.png');
				break;
			default:
				break;
		}
		this.children.push(container)
		return container
	}

	private addRef(scope: string, loc: vscode.Location) {
		let dir = this.getOrCreateDirContainer(loc)
		let file = dir.getOrCreateFileContainer(loc)
		let container = file.getOrCreateScopeContainer(scope)
		container.addLeaf(loc)
	}

	private addImport(loc: vscode.Location) {
		let dir = this.getOrCreateDirContainer(loc)
		let file = dir.getOrCreateFileContainer(loc)
		file.addLeaf(loc)
	}

	private addUnclassified(loc: vscode.Location) {
		let dir = this.getOrCreateDirContainer(loc)
		let file = dir.getOrCreateFileContainer(loc)
		file.addLeaf(loc)
	}

	private addLeaf(loc: vscode.Location) {
		let leaf = new TreeLeaf(loc)
		leaf.parent = this;
		this.children.push(leaf)
	}

	static newDeclarationContainer(): TreeContainer {
		return new TreeContainer("Declaration")
	}

	static newFunctionContainer(): TreeContainer {
		return new TreeContainer("Usage in functions")
	}

	static newTypeContainer(): TreeContainer {
		return new TreeContainer("Usage in type defination")
	}

	static newImportContainer(): TreeContainer {
		return new TreeContainer("Usage in imports")
	}

	static buildRoots(locations: vscode.Location[]): TreeContainer[] {
		let declContainer = this.newDeclarationContainer()
		let funcContainer = this.newFunctionContainer()
		let typeContainer = this.newTypeContainer()
		let importContainer = this.newImportContainer()
		let unclassifiedContainer = new TreeContainer()

		locations.forEach((loc, index) => {
			let srcInfo = GoParser.getSrcInfo(loc.uri.fsPath)
			if (!srcInfo) {
				unclassifiedContainer.addUnclassified(loc)
				return
			}
			let decl = srcInfo.queryDecl(loc.range.start.line)

			if (index === 0 && loc.range.start.line === decl?.start) {
				declContainer.addLeaf(loc)
				return
			}

			if (decl != undefined) {
				switch (decl.type) {
					case "Function":
						funcContainer.addRef(decl.getDescription(), loc)
						return;
					case "Method":
						funcContainer.addRef(decl.getDescription(), loc)
						return;
					case "Import":
						importContainer.addImport(loc)
						return;
					case "Type":
						typeContainer.addRef(decl.getDescription(), loc)
						return;
				}
			}

			unclassifiedContainer.addUnclassified(loc)
		})

		return [declContainer, funcContainer, typeContainer, importContainer, unclassifiedContainer]
			.filter(item => item.children.length > 0);
	}
}
