import * as vscode from 'vscode';
import { CancellationToken, languages, Disposable, Position, ReferenceContext, ReferenceProvider, TextDocument } from 'vscode';
import { FeatureClient } from 'vscode-languageclient/lib/common/features';
import { ReferencesFeature, ReferencesMiddleware } from 'vscode-languageclient/lib/common/reference';
import { DocumentSelector, ReferencesRequest, TextDocumentRegistrationOptions } from 'vscode-languageserver-protocol';
import { GoParser } from './goparser';
import { itemClickCommand, TreeContainer, TreeLeaf } from './tree';

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
					console.log(`Request: ${document.uri.toString()} at position ${position.line}:${position.character}`);
					return client.sendRequest(ReferencesRequest.type, client.code2ProtocolConverter.asReferenceParams(document, position, options), token).then((result) => {
						if (token.isCancellationRequested) {
							return null;
						}
						return client.protocol2CodeConverter.asReferences(result, token).then((value) => {
							TTreeProvider.instance.refresh(value)
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

export class TTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> =
		new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	private elements: vscode.TreeItem[] = [];

	static instance: TTreeProvider;

	static setup(ctx: vscode.ExtensionContext) {
		this.instance = new TTreeProvider();
		ctx.subscriptions.push(
			vscode.window.registerTreeDataProvider('go.FindAllReferences', this.instance)
		);
		ctx.subscriptions.push(
			vscode.commands.registerCommand(itemClickCommand, (location: vscode.Location) => {
				// 打开文件并跳转到指定行列
				vscode.workspace.openTextDocument(location.uri).then(doc => {
					vscode.window.showTextDocument(doc).then(editor => {
						// 设置选择范围并滚动到该行
						editor.selection = new vscode.Selection(location.range.start, location.range.end);
						editor.revealRange(location.range, vscode.TextEditorRevealType.InCenter);
					});
				});
			})
		);
		ctx.subscriptions.push(
			vscode.workspace.onDidSaveTextDocument(doc => GoParser.fileChanged(doc.fileName))
		);
		GoParser.init();
	}

	getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
		if (!element) {
			return this.elements;
		} else if (element instanceof TreeContainer) {
			return element.getChildren();
		}
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
		if (element instanceof TreeContainer) {
			return element.resolve()
		} else if (element instanceof TreeLeaf) {
			return element.resolve()
		} else {
			return element
		}
	}

	refresh(locations: vscode.Location[] | undefined): void {
		if (locations != undefined) {
			this.elements = TreeContainer.buildRoots(locations)
		}
		this._onDidChangeTreeData.fire();
	}
}


