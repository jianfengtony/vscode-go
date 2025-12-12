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
			case 0:
				element.label = this.getRelativePathFromUri(element.location.uri);
				break;
			case 1:
				const line = element.location.range.start.line + 1;
				const character = element.location.range.start.character + 1;
				element.label = `Line ${line}, Col ${character}`;
				element.contextValue = 'reference';
				break;
		}
		return element;
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
	level: number;
	location: vscode.Location;
	children: TTreeItem[] | undefined;

	constructor(level: number, location: vscode.Location) {
		super("unknown", vscode.TreeItemCollapsibleState.None);
		this.level = level;
		this.location = location
		if (level === 1) {
			this.command = {
				command: itemClickCommand,
				title: 'Item Click',
				arguments: [location]
			}
		}
	}

	private addChild(item: TTreeItem) {
		if (!this.children) {
			this.children = [];
		}
		this.children.push(item);
	}

	static getElementWithSameFsPath(elements: TTreeItem[], fsPath: string): TTreeItem | undefined {
		for (let el of elements) {
			if (el.location.uri.fsPath === fsPath) {
				return el;
			}
		}
		return undefined;
	}

	static getBasenameFromUri(uri: vscode.Uri): string {
		let parts = uri.fsPath.split(/\/|\\/);
		return parts[parts.length - 1];
	}

	static buildItems(locations: vscode.Location[]): TTreeItem[] {
		let elements: TTreeItem[] = [];

		for (let loc of locations) {
			let element = this.getElementWithSameFsPath(elements, loc.uri.fsPath);
			if (!element) { // 创建顶层节点
				element = new TTreeItem(0, loc);
				element.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
				element.iconPath = vscode.Uri.file(vscode.extensions.getExtension('golang.go')!.extensionPath + '/media/go-logo-blue.png')
				elements.push(element);
			}
			element.addChild(new TTreeItem(1, loc));
		}
		return elements;
	}
}