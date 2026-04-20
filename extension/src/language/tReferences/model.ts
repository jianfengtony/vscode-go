import * as vscode from 'vscode';
import { GoParser } from './goparser';
import path from 'path';

export const itemClickCommand = 'go.ReferencesItemClick';

const mediaPath = vscode.extensions.getExtension('golang.go')!.extensionPath + '/media/';

export class TreeLeaf extends vscode.TreeItem {
	private location: vscode.Location
	private resolved: boolean = false
	parent: TreeContainer | null = null;

	constructor(location: vscode.Location, rawLine?: string) {
		super('', vscode.TreeItemCollapsibleState.None)
		this.location = location
		this.command = {
			command: itemClickCommand,
			title: 'Item Click',
			arguments: [location]
		}
		
		if (rawLine !== undefined) {
			this.setLabelFromRawLine(rawLine)
			this.resolved = true
		} else {
			this.label = `line: ${location.range.start.line + 1}:${location.range.start.character + 1}`
		}
	}

	private setLabelFromRawLine(rawLine: string) {
		const trimmedStart = rawLine.trimStart();
		const leading = rawLine.length - trimmedStart.length;
		const start = this.location.range.start.character - leading;
		const end = this.location.range.end.character - leading;
		const lineN = `${this.location.range.start.line + 1}: `;
		this.label = {
			label: lineN + trimmedStart.trimEnd(),
			highlights: [[start + lineN.length, end + lineN.length]]
		} as vscode.TreeItemLabel;
	}

	public async resolve(): Promise<TreeLeaf> {
		if (this.resolved) {
			return this
		}
		const doc = await vscode.workspace.openTextDocument(this.location.uri);
		const rawLine = doc.lineAt(this.location.range.start.line).text;
		this.setLabelFromRawLine(rawLine)
		this.resolved = true
		return this
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
				container.iconPath = new vscode.ThemeIcon('symbol-function', new vscode.ThemeColor('symbolIcon.functionForeground'));
				break;
			case "Method":
				container.iconPath = new vscode.ThemeIcon('symbol-method', new vscode.ThemeColor('symbolIcon.methodForeground'));
				break;
			case "Type":
				container.iconPath = new vscode.ThemeIcon('symbol-structure', new vscode.ThemeColor('symbolIcon.typeForeground'));
				break;
			default:
				break;
		}
		this.children.push(container)
		return container
	}

	private addDecl(loc: vscode.Location, rawLine?: string) {
		let dir = this.getOrCreateDirContainer(loc)
		let file = dir.getOrCreateFileContainer(loc)
		file.addLeaf(loc, rawLine)
	}

	private addRef(scope: string, loc: vscode.Location, rawLine?: string) {
		let dir = this.getOrCreateDirContainer(loc)
		let file = dir.getOrCreateFileContainer(loc)
		let container = file.getOrCreateScopeContainer(scope)
		container.addLeaf(loc, rawLine)
	}

	private addImport(loc: vscode.Location, rawLine?: string) {
		let dir = this.getOrCreateDirContainer(loc)
		let file = dir.getOrCreateFileContainer(loc)
		file.addLeaf(loc, rawLine)
	}

	private addUnclassified(loc: vscode.Location, rawLine?: string) {
		let dir = this.getOrCreateDirContainer(loc)
		let file = dir.getOrCreateFileContainer(loc)
		file.addLeaf(loc, rawLine)
	}

	private addLeaf(loc: vscode.Location, rawLine?: string) {
		let leaf = new TreeLeaf(loc, rawLine)
		leaf.parent = this
		this.children.push(leaf)
	}

	static newDeclarationContainer(): TreeContainer {
		return new TreeContainer("Declaration")
	}

	static newFunctionContainer(): TreeContainer {
		return new TreeContainer("Usage in functions")
	}

	static newTypeContainer(): TreeContainer {
		return new TreeContainer("Usage in type definition")
	}

	static newImportContainer(): TreeContainer {
		return new TreeContainer("Usage in imports")
	}

	static async buildRoots(locations: vscode.Location[]): Promise<TreeContainer[]> {
		let declContainer = this.newDeclarationContainer()
		let funcContainer = this.newFunctionContainer()
		let typeContainer = this.newTypeContainer()
		let importContainer = this.newImportContainer()
		let unclassifiedContainer = new TreeContainer()

		const prepData = await Promise.all(locations.map(async (loc) => {
			const doc = await vscode.workspace.openTextDocument(loc.uri)
			const rawLine = doc.lineAt(loc.range.start.line).text
			const srcInfo = GoParser.getSrcInfo(loc.uri.fsPath)
			return { loc, rawLine, srcInfo }
		}))

		prepData.forEach(({ loc, rawLine, srcInfo }, index) => {
			if (!srcInfo) {
				unclassifiedContainer.addUnclassified(loc, rawLine)
				return
			}
			const decl = srcInfo.queryDecl(loc.range.start.line)

			if (index === 0 && loc.range.start.line === decl?.start) {
				declContainer.addDecl(loc, rawLine)
				return
			}

			if (decl != undefined) {
				switch (decl.type) {
					case "Function":
						funcContainer.addRef(decl.getDescription(), loc, rawLine)
						return
					case "Method":
						funcContainer.addRef(decl.getDescription(), loc, rawLine)
						return
					case "Import":
						importContainer.addImport(loc, rawLine)
						return
					case "Type":
						typeContainer.addRef(decl.getDescription(), loc, rawLine)
						return
				}
			}

			unclassifiedContainer.addUnclassified(loc, rawLine)
		})

		return [declContainer, funcContainer, typeContainer, importContainer, unclassifiedContainer]
			.filter(item => item.children.length > 0)
	}
}
