import * as vscode from 'vscode';
import { languages, Disposable, ReferenceProvider, CancellationToken } from 'vscode';
import { FeatureClient } from 'vscode-languageclient/lib/common/features';
import { ProvideReferencesSignature, ReferencesFeature, ReferencesMiddleware } from 'vscode-languageclient/lib/common/reference';
import { DocumentSelector, ReferencesRequest, TextDocumentRegistrationOptions } from 'vscode-languageserver-protocol';
import { GoParser } from './goparser';
import { itemClickCommand, TreeContainer, TreeLeaf } from './model';
import { LanguageClient } from 'vscode-languageclient/node';

const REF_FILTER_CONFIG_KEY = 'findAllReferencesInclude';

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

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element
	}

	async refresh(locations: vscode.Location[] | undefined): Promise<void> {
		if (locations != undefined) {
			this.elements = await TreeContainer.buildRoots(locations)
		} else {
			this.elements = []
		}
		this._onDidChangeTreeData.fire()
	}
}

export namespace TTreeView {
	export const provider = new TTreeProvider()
	export const treeView = vscode.window.createTreeView('go.findAllReferences', {
		treeDataProvider: provider,
		showCollapseAll: true
	});

	let lastDocument: vscode.TextDocument | undefined;
	let lastPosition: vscode.Position | undefined;
	let lastLocations: vscode.Location[] | undefined;

	function getRefFilterConfig(): string {
		const config = vscode.workspace.getConfiguration('go');
		return config.get<string>(REF_FILTER_CONFIG_KEY, 'product');
	}

	function isTestFile(uri: vscode.Uri): boolean {
		return uri.fsPath.endsWith('_test.go');
	}

	function applyFilterAndRefresh(locations: vscode.Location[], filter?: string): Promise<void> {
		lastLocations = locations;
		const currentFilter = filter || getRefFilterConfig();
		const filtered = locations.filter(loc => {
			const isTest = isTestFile(loc.uri);
			if (currentFilter === 'all') return true;
			return currentFilter === 'test' ? isTest : !isTest;
		});
		return TTreeView.provider.refresh(filtered).then(() => {
			const filterMessages: Record<string, string> = {
				'product': 'Showing: Product files only',
				'test': 'Showing: Test files only',
				'all': 'Showing: All references'
			};
			TTreeView.treeView.message = filterMessages[currentFilter] || undefined;
		});
	}

	export function setup(ctx: vscode.ExtensionContext, client?: LanguageClient) {
		GoParser.init();
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
			vscode.commands.registerCommand('go.findAllReferences.refresh',
				() => refreshReferences(client))
		);
		ctx.subscriptions.push(
			vscode.commands.registerCommand('go.findAllReferences.filterProduct',
				() => {
					if (lastLocations) {
						applyFilterAndRefresh(lastLocations, 'product');
					}
				})
		);
		ctx.subscriptions.push(
			vscode.commands.registerCommand('go.findAllReferences.filterTest',
				() => {
					if (lastLocations) {
						applyFilterAndRefresh(lastLocations, 'test');
					}
				})
		);
		ctx.subscriptions.push(
			vscode.commands.registerCommand('go.findAllReferences.filterAll',
				() => {
					if (lastLocations) {
						applyFilterAndRefresh(lastLocations, 'all');
					}
				})
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

		lastDocument = document;
		lastPosition = position;

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
						if (!locations || locations.length === 0) {
							vscode.window.showInformationMessage('No references found.');
							TTreeView.treeView.message = undefined;
							return;
						}
						lastLocations = locations;
						applyFilterAndRefresh(locations).then(() => {
							vscode.commands.executeCommand('setContext', 'go.showAllReferences', true);

							if (TTreeView.provider.elements.length > 0) {
								TTreeView.treeView.reveal(TTreeView.provider.elements[0], {
									expand: true,
									select: true
								});
							}
						});
					});
			}, (error) => {
				TTreeView.treeView.message = undefined;
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

	function refreshReferences(client?: LanguageClient) {
		if (!client) {
			vscode.window.showWarningMessage('Language client is not available.');
			return;
		}

		if (!lastDocument || !lastPosition) {
			vscode.window.showInformationMessage('No previous references query found. Please run "Find All References" first.');
			return;
		}

		const document = lastDocument;
		const position = lastPosition;
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
						if (!locations || locations.length === 0) {
							vscode.window.showInformationMessage('No references found.');
							TTreeView.treeView.message = undefined;
							return;
						}
						lastLocations = locations;
						applyFilterAndRefresh(locations);
					});
			}, (error) => {
				TTreeView.treeView.message = undefined;
				return client.handleFailedRequest(ReferencesRequest.type, token, error, null);
			});
	}
}