import * as vscode from 'vscode';
import { languages, Disposable, ReferenceProvider, CancellationToken } from 'vscode';
import { FeatureClient } from 'vscode-languageclient/lib/common/features';
import { ProvideReferencesSignature, ReferencesFeature, ReferencesMiddleware } from 'vscode-languageclient/lib/common/reference';
import { DocumentSelector, ReferencesRequest, TextDocumentRegistrationOptions } from 'vscode-languageserver-protocol';
import { GoParser } from './goparser';
import { itemClickCommand, TreeContainer, TreeLeaf } from './model';
import { LanguageClient } from 'vscode-languageclient/node';

export class TReferenceFeature extends ReferencesFeature {
	public constructor(client: FeatureClient<ReferencesMiddleware>) {
		super(client);
	}

	protected registerLanguageProvider(options: TextDocumentRegistrationOptions): [Disposable, ReferenceProvider] {
		const selector = options.documentSelector!;
		const provider: ReferenceProvider = {
			provideReferences: (document, position, options, token) => {
				const client = this._client;
				const _providerReferences: ProvideReferencesSignature = (document, position, options, token) => {
					return client.sendRequest(ReferencesRequest.type, client.code2ProtocolConverter.asReferenceParams(document, position, options), token).then((result) => {
						if (token.isCancellationRequested) {
							return null;
						}
						return client.protocol2CodeConverter.asReferences(result, token)
							.then(value => {
								TTreeView.provider.refresh(value)
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
		return [this.registerProvider1(selector, provider), provider];
	}

	private registerProvider1(selector: DocumentSelector, provider: ReferenceProvider): Disposable {
		return languages.registerReferenceProvider(this._client.protocol2CodeConverter.asDocumentSelector(selector), provider);
	}
}

export class TTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> =
		new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	elements: vscode.TreeItem[] = [];

	getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
		if (!element) {
			return this.elements;
		} else if (element instanceof TreeContainer) {
			return element.getChildren();
		}
	}

	getParent(element: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem> {
		if (element instanceof TreeContainer) {
			return element.parent;
		} else if (element instanceof TreeLeaf) {
			return element.parent;
		}
		return null;
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
		} else {
			this.elements = []
		}
		this._onDidChangeTreeData.fire();
	}
}

export namespace TTreeView {
	export const provider = new TTreeProvider()
	export const treeView = vscode.window.createTreeView('go.findAllReferences', {
		treeDataProvider: provider,
		showCollapseAll: true
	});

	export function setup(ctx: vscode.ExtensionContext, client?: LanguageClient) {
		GoParser.init();
		// client?.registerFeature(new TReferenceFeature(client));
		ctx.subscriptions.push(
			vscode.commands.registerCommand(itemClickCommand, openDocument)
		);
		ctx.subscriptions.push(
			vscode.commands.registerCommand('go.findAllReferences.expandAll',
				() => expandAllElements(provider.elements))
		);
		ctx.subscriptions.push(
			vscode.commands.registerCommand('go.findAllReferences.findAll',
				() => findAllReferences(client))
		);
		ctx.subscriptions.push(
			vscode.workspace.onDidSaveTextDocument(GoParser.fileChanged)
		);
	}

	function findAllReferences(client?: LanguageClient) {
		if (!client) {
			vscode.window.showWarningMessage('Language client is not available.');
			return;
		}

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage('No active editor found to find references.');
			return;
		}
		const document = editor.document;
		const position = editor.selection.active;
		const options = { includeDeclaration: true };
		const token = { isCancellationRequested: false } as CancellationToken;

		const params = client.code2ProtocolConverter.asReferenceParams(document, position, options);
		client.sendRequest(ReferencesRequest.type, params, token)
			.then((result) => {
				if (token.isCancellationRequested) {
					return null;
				}
				client.protocol2CodeConverter.asReferences(result, token)
					.then(locations => {
						TTreeView.provider.refresh(locations)
						vscode.commands.executeCommand('setContext', 'go.showAllReferences', true);
					});
			}, (error) => {
				return client.handleFailedRequest(ReferencesRequest.type, token, error, null);
			});
	}

	function openDocument(loc: vscode.Location) {
		// 打开文件并跳转到指定行列
		vscode.workspace.openTextDocument(loc.uri).then(doc => {
			vscode.window.showTextDocument(doc).then(editor => {
				// 设置选择范围并滚动到该行
				editor.selection = new vscode.Selection(loc.range.start, loc.range.end);
				editor.revealRange(loc.range, vscode.TextEditorRevealType.InCenter);
			});
		});
	}

	function expandAllElements(elements: vscode.TreeItem[]) {
		elements.forEach(element => {
			if (element instanceof TreeContainer) {
				treeView.reveal(element, { expand: true });
				expandAllElements(element.getChildren());
			}
		});
	}
}