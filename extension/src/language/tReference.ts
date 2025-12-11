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
							for (const ref of value || []) {
								console.log(` - ${ref.uri.toString()} [${ref.range.start.line + 1},${ref.range.start.character + 1}]`);
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

enum MyTreeNodeType {
	File,
	TopDeclare,
	Reference
}

class MyTreeNode extends vscode.TreeItem {
	// private type: MyTreeNodeType
	constructor(label: string, uri: vscode.Uri, range: vscode.Range) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.command = {
			command: 'tgo.itemClick',
			title: 'Item Click',
			arguments: [uri, range]
		}
	}
}

export class MyTreeProvider implements vscode.TreeDataProvider<MyTreeNode> {
	private _onDidChangeTreeData: vscode.EventEmitter<MyTreeNode | undefined | null | void> = new vscode.EventEmitter<MyTreeNode | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<MyTreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

	private elements: MyTreeNode[] = [];

	static setup(ctx: vscode.ExtensionContext) {
		ctx.subscriptions.push(vscode.window.registerTreeDataProvider('tgo.FindAllReferences', new this()));
		ctx.subscriptions.push(vscode.commands.registerCommand('tgo.itemClick', (uri: vscode.Uri, range: vscode.Range) => {
			// 打开文件并跳转到指定行列
			vscode.workspace.openTextDocument(uri).then(doc => {
				vscode.window.showTextDocument(doc).then(editor => {
					// 设置选择范围并滚动到该行
					editor.selection = new vscode.Selection(range.start, range.end);
					editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
				});
			});
		}));
	}

	getChildren(element?: MyTreeNode): vscode.ProviderResult<MyTreeNode[]> {
		if (!element) {
			return Promise.resolve(this.elements);
		} else {
			let nodes = []
			nodes.push(new MyTreeNode('func detail 1', vscode.Uri.file('/path/to/file1'), new vscode.Range(0, 0, 0, 10)));
			nodes.push(new MyTreeNode('func detail 2', vscode.Uri.file('/path/to/file2'), new vscode.Range(1, 0, 1, 10)));
			return Promise.resolve(nodes);
		}
	}

	getTreeItem(element: MyTreeNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return element;
	}

	refresh(uri: vscode.Uri, position: vscode.Position): void {
		this.elements = [];
		this._onDidChangeTreeData.fire();
	}
}