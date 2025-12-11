import { execSync } from 'child_process';
import * as vscode from 'vscode';
import { CancellationToken, languages, Disposable, Position, ReferenceContext, ReferenceProvider, TextDocument } from 'vscode';
import { FeatureClient } from 'vscode-languageclient/lib/common/features';
import { ReferencesFeature, ReferencesMiddleware } from 'vscode-languageclient/lib/common/reference';
import { DocumentSelector, ReferencesRequest, TextDocumentRegistrationOptions } from 'vscode-languageserver-protocol';

export class TReferenceFeature extends ReferencesFeature {
	public constructor(client: FeatureClient<ReferencesMiddleware>) {
		super(client);
	}

	public registerLanguageProvider(options: TextDocumentRegistrationOptions): [Disposable, ReferenceProvider] {
		const selector = options.documentSelector;
		const provider = {
			provideReferences: (document: TextDocument, position: Position, options: ReferenceContext, token: CancellationToken) => {
				const client = this._client;
				const _providerReferences = (document: TextDocument, position: Position, options: ReferenceContext, token: CancellationToken) => {
					return client.sendRequest(ReferencesRequest.type, client.code2ProtocolConverter.asReferenceParams(document, position, options), token).then((result) => {
						if (token.isCancellationRequested) {
							return null;
						}
						return client.protocol2CodeConverter.asReferences(result, token).then((value) => {
							if (value) {
								TTreeProvider.instance.refresh(TTreeItem.buildItems(value))
							}
							return value;
						});
					}, (error) => {
						return client.handleFailedRequest(ReferencesRequest.type, token, error, null);
					});
				};
				const middleware = client.middleware;
				return middleware.provideReferences
					? middleware.provideReferences(document, position, options, token, _providerReferences)
					: _providerReferences(document, position, options, token);
			}
		};
		return [this.registerProvider1(selector!, provider), provider];
	}

	private registerProvider1(selector: DocumentSelector, provider: ReferenceProvider): Disposable {
		return languages.registerReferenceProvider(this._client.protocol2CodeConverter.asDocumentSelector(selector), provider);
	}
}

const itemClickCommand = 'go.RefencesItemClick';

export class TTreeProvider implements vscode.TreeDataProvider<TTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<TTreeItem | undefined | null | void> = new vscode.EventEmitter<TTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<TTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	private elements: TTreeItem[] = [];

	static instance: TTreeProvider;

	static setup(ctx: vscode.ExtensionContext) {
		let provider = new TTreeProvider();
		ctx.subscriptions.push(vscode.window.registerTreeDataProvider('go.FindAllReferences', provider));
		ctx.subscriptions.push(vscode.commands.registerCommand(itemClickCommand, (location: vscode.Location) => {
			// 打开文件并跳转到指定行列
			vscode.workspace.openTextDocument(location.uri).then(doc => {
				vscode.window.showTextDocument(doc).then(editor => {
					// 设置选择范围并滚动到该行
					editor.selection = new vscode.Selection(location.range.start, location.range.end);
					editor.revealRange(location.range, vscode.TextEditorRevealType.InCenter);
				});
			});
		}));
		this.instance = provider;
	}

	getChildren(element?: TTreeItem): vscode.ProviderResult<TTreeItem[]> {
		if (!element) {
			return this.elements;
		} else {
			return element.children;
		}
	}

	getTreeItem(element: TTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
		switch (element.level) {
			case TTreeItem.LEVEL_1:
				element.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
				element.iconPath = vscode.Uri.file(vscode.extensions.getExtension('golang.go')!.extensionPath + '/media/go-logo-blue.png')
				element.label = this.getRelativePathFromUri(element.location.uri);
				element.description = element.children ? `(${element.children.length})` : '';
				return element;
			case TTreeItem.LEVEL_2:
				element.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
				element.description = element.children ? `(${element.children.length})` : '';
				return element;
			case TTreeItem.LEVEL_3:
				return vscode.workspace.openTextDocument(element.location.uri).then(doc => {
					element.label = doc.lineAt(element.location.range.start.line).text.trim();
					return element;
				});
			default:
				return element;
		}
	}

	refresh(elements: TTreeItem[]): void {
		this.elements = elements;
		this._onDidChangeTreeData.fire();
	}

	private getRelativePathFromUri(uri: vscode.Uri): string {
		let workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
		if (workspaceFolder) {
			return uri.fsPath.substring(workspaceFolder.uri.fsPath.length + 1);
		}
		return uri.fsPath;
	}
}

class TTreeItem extends vscode.TreeItem {
	public static LEVEL_1 = 1;
	public static LEVEL_2 = 2;
	public static LEVEL_3 = 3;

	level: number;
	location: vscode.Location;
	children: TTreeItem[] | undefined;

	constructor(level: number, location: vscode.Location) {
		super("unknown", vscode.TreeItemCollapsibleState.None);
		this.level = level;
		this.location = location
		if (level === TTreeItem.LEVEL_3) {
			this.command = {
				command: itemClickCommand,
				title: 'Item Click',
				arguments: [location]
			}
		}
	}

	private addDecl(location: vscode.Location) {
		if (!this.children) {
			this.children = [];
		}
		let srcInfo = GoParser.getSrcInfo(location.uri.fsPath);
		let decl = srcInfo.queryDeclByLine(location.range.start.line)

		let element = this.children.find(child => child.label === decl?.getDescription());
		if (!element) {
			element = new TTreeItem(TTreeItem.LEVEL_2, location);
			element.label = decl ? decl.getDescription() : 'unknown';
			this.children.push(element);
		}
		
		element.addRef(location);
	}

	private addRef(location: vscode.Location) {
		if (!this.children) {
			this.children = [];
		}
		this.children.push(new TTreeItem(TTreeItem.LEVEL_3, location));
	}

	static getBasenameFromUri(uri: vscode.Uri): string {
		let parts = uri.fsPath.split(/\/|\\/);
		return parts[parts.length - 1];
	}

	static buildItems(locations: vscode.Location[]): TTreeItem[] {
		let elements: TTreeItem[] = [];
		for (let loc of locations) {
			let element = elements.find(el => el.location.uri.fsPath === loc.uri.fsPath);
			if (!element) {
				element = new TTreeItem(TTreeItem.LEVEL_1, loc);
				elements.push(element);
				console.log(`Added element for file: ${loc.uri.fsPath}`);
			}
			element.addDecl(loc);
		}
		return elements;
	}
}

namespace GoParser {

	class DeclInfo {
		start: number | undefined;
		end: number | undefined;
		type: string | undefined
		name: string | undefined;

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
		packageName: string = '';
		decls: DeclInfo[] = [];

		constructor(path: string) {
			this.path = path;
		}

		addDecl(decl: DeclInfo) {
			this.decls.push(decl);
		}

		queryDeclByLine(line: number): DeclInfo | undefined {
			for (let decl of this.decls) {
				if (decl.start !== undefined && decl.end !== undefined) {
					if (decl.start <= line && line <= decl.end) {
						return decl
					}
				}
			}
			return undefined
		}

		setPackageName(name: string) {
			this.packageName = name;
		}
	}

	var srcCache = new Map<string, SrcInfo>();

	export function getSrcInfo(path: string): SrcInfo {
		if (srcCache.has(path)) {
			return srcCache.get(path)!;
		}
		let srcInfo = parseSrc(path);
		srcCache.set(path, srcInfo);
		return srcInfo;
	}

	function parseSrc(path: string): SrcInfo {
		let goParser = vscode.Uri.file(vscode.extensions.getExtension('golang.go')!.extensionPath + '/media/gosrcparser/main.go').fsPath;
		let srcInfo = new SrcInfo(path);
		execSync(`go run ${goParser} -src ${path}`).toString().trim().split('\n')
			.forEach((line, index) => {
				console.log(`line ${index}: ${line}`);
				if (index === 0) {
					srcInfo.setPackageName(line.trim());
				} else {
					let parts = line.split(',');
					let decl = new DeclInfo
					if (parts.length >= 3) {
						decl.type = parts[0];
						decl.start = parseInt(parts[1]) - 1;
						decl.end = parseInt(parts[2]) - 1;
					}
					if (parts.length >= 4) {
						decl.name = parts[3];
					}
					srcInfo.addDecl(decl);
				}
			});
		return srcInfo;
	}
}

