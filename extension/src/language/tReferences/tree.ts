import * as vscode from 'vscode';
import { GoParser } from './goparser';
import path from 'path';

export const itemClickCommand = 'go.RefencesItemClick';

export class TreeLeaf extends vscode.TreeItem {
	private location: vscode.Location

	constructor(location: vscode.Location) {
		super("Unclassified", vscode.TreeItemCollapsibleState.None)
		this.location = location
		this.command = {
			command: itemClickCommand,
			title: 'Item Click',
			arguments: [location]
		}
	}

	public async resolve(): Promise<TreeLeaf> {
		const doc = await vscode.workspace.openTextDocument(this.location.uri);
		this.label = doc.lineAt(this.location.range.start.line).text.trim();
		this.iconPath = vscode.Uri.file(vscode.extensions.getExtension('golang.go')!.extensionPath + '/media/go-logo-white.svg')
		return this;
	}
}

export class TreeContainer extends vscode.TreeItem {
	private children: vscode.TreeItem[];

	constructor(label: string = "Unclassified") {
		super(label);
		this.children = []
	}

	public resolve(): TreeContainer {
		this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
		if (this.children.length <= 1) {
			this.description = `${this.children.length} result`
		} else {
			this.description = `${this.children.length} results`
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
		container.iconPath = vscode.Uri.file(vscode.extensions.getExtension('golang.go')!.extensionPath + '/media/go-logo-blue.png')
		this.children.push(container)
		return container
	}

	private getOrCreateScopeContainer(scopeName: string): TreeContainer {
		const existing = this.children.find((child) => child.label === scopeName)
		if (existing && existing instanceof TreeContainer) {
			return existing
		}
		const container = new TreeContainer(scopeName)
		this.children.push(container)
		return container
	}

	private addRef(scopeName: string, loc: vscode.Location) {
		let dir = this.getOrCreateDirContainer(loc)
		let file = dir.getOrCreateFileContainer(loc)
		let scope = file.getOrCreateScopeContainer(scopeName)
		scope.addLeaf(loc)
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
		this.children.push(new TreeLeaf(loc))
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

