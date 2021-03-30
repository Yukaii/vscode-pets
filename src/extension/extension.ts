import * as path from 'path';
import * as vscode from 'vscode';
import { PetSize, PetColor, PetType } from '../common/types';

const EXTRA_PETS_KEY = 'vscode-pets.extra-pets';
const EXTRA_PETS_KEY_TYPES = EXTRA_PETS_KEY + '.types';
const EXTRA_PETS_KEY_COLORS = EXTRA_PETS_KEY + '.colors';
const DEFAULT_PET_SCALE = PetSize.nano;
const DEFAULT_COLOR = PetColor.brown;
const DEFAULT_PET_TYPE = PetType.cat;

const ALL_PETS = [PetType.cat, PetType.clippy, PetType.dog, PetType.rubberduck, PetType.snake];
const ALL_COLORS = [PetColor.black, PetColor.brown, PetColor.green, PetColor.yellow];
const ALL_SCALES = [PetSize.nano, PetSize.medium, PetSize.large];

function getConfiguredSize(): PetSize {
	var size = vscode.workspace.getConfiguration("vscode-pets").get<PetSize>("petSize", DEFAULT_PET_SCALE);
	if (ALL_SCALES.lastIndexOf(size) === -1){
		size = DEFAULT_PET_SCALE;
	}
	return size;
}

class PetSpecification {
	color: PetColor;
	type: PetType;
	size: PetSize;

	constructor(color: PetColor, type: PetType, size: PetSize) {
		this.color = color;
		this.type = type;
		this.size = size;
	};

	static fromConfiguration(): PetSpecification{
		var color = vscode.workspace.getConfiguration("vscode-pets").get<PetColor>("petColor", DEFAULT_COLOR);
		if (ALL_COLORS.lastIndexOf(color) === -1){
			color = DEFAULT_COLOR;
		}
		var type = vscode.workspace.getConfiguration("vscode-pets").get<PetType>("petType", DEFAULT_PET_TYPE);
		if (ALL_PETS.lastIndexOf(type) === -1){
			type = DEFAULT_PET_TYPE;
		}
		
		return new PetSpecification(color, type, getConfiguredSize());
	}

	static collectionFromMemento(context: vscode.ExtensionContext, size: PetSize): PetSpecification[] {
		var contextTypes = context.globalState.get<PetType[]>(EXTRA_PETS_KEY_TYPES, []);
		var contextColors = context.globalState.get<PetColor[]>(EXTRA_PETS_KEY_COLORS, []);
		var result: PetSpecification[] = new Array();
		for (let index = 0; index < contextTypes.length; index++) {
			result.push(new PetSpecification(contextColors![index], contextTypes[index], size));
		}
		return result;
	}
}

export function storeCollectionAsMemento(context: vscode.ExtensionContext, collection: PetSpecification[]){
	var contextTypes = new Array(collection.length);
	var contextColors = new Array(collection.length);
	for (let index = 0; index < collection.length; index++) {
		contextTypes[index] = collection[index].type;
		contextColors[index] = collection[index].color;
	}
	context.globalState.update(EXTRA_PETS_KEY_TYPES, contextTypes);
	context.globalState.update(EXTRA_PETS_KEY_COLORS, contextColors);
	context.globalState.setKeysForSync([EXTRA_PETS_KEY_TYPES, EXTRA_PETS_KEY_COLORS]);
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('vscode-pets.start', () => {
			const spec = PetSpecification.fromConfiguration();
			PetPanel.createOrShow(context.extensionUri, context.extensionPath, spec.color, spec.type, spec.size);
			
			// Recover extra pets from last session
			if (PetPanel.currentPanel){
				var collection = PetSpecification.collectionFromMemento(context, getConfiguredSize());
				collection.forEach(item => {
					PetPanel.currentPanel!.spawnPet(item);
				});
			}
		})
	);

	const spec = PetSpecification.fromConfiguration();
	const provider = new PetsViewProvider(context.extensionUri, context.extensionPath, spec.color, spec.type, spec.size);
	
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(PetsViewProvider.viewType, provider));

	context.subscriptions.push(
		vscode.commands.registerCommand('vscode-pets.throw-ball', () => {
			if (PetPanel.currentPanel) {
				PetPanel.currentPanel.throwBall();
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('vscode-pets.delete-pets', () => {
			context.globalState.update(EXTRA_PETS_KEY + '.types', []);
			context.globalState.update(EXTRA_PETS_KEY + '.colors', []);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('vscode-pets.spawn-pet', async () => {
			if (PetPanel.currentPanel) {
				const petType = await vscode.window.showQuickPick(ALL_PETS, {
					placeHolder: 'Select a pet',
				});
				var petColor: PetColor = DEFAULT_COLOR;
				var choices;
				switch (petType as PetType){
					case PetType.rubberduck:
						petColor = PetColor.yellow;
						break;
					case PetType.snake:
						petColor = PetColor.green;
						break;
					case PetType.cat:
					case PetType.dog:
						choices = [PetColor.black, PetColor.brown];
						petColor = await vscode.window.showQuickPick(choices, {
							placeHolder: 'Select a color',
						}) as PetColor;
						break;
					case PetType.clippy:
						choices = [PetColor.black, PetColor.brown, PetColor.green];
						petColor = await vscode.window.showQuickPick(choices, {
							placeHolder: 'Select a color',
						}) as PetColor;
						break;
				}
				const spec = new PetSpecification(petColor, petType as PetType, getConfiguredSize());
				PetPanel.currentPanel.spawnPet(spec);
				var collection = PetSpecification.collectionFromMemento(context, getConfiguredSize());
				collection.push(spec);
				storeCollectionAsMemento(context, collection);
			}
		})
	);

	// Listening to configuration changes
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('vscode-pets.petColor') || e.affectsConfiguration('vscode-pets.petType') || e.affectsConfiguration('vscode-pets.petSize')) {
			const spec = PetSpecification.fromConfiguration();
			if (PetPanel.currentPanel) {
				PetPanel.currentPanel.updatePetColor(spec.color);
				PetPanel.currentPanel.updatePetSize(spec.size);
				PetPanel.currentPanel.updatePetType(spec.type);
				PetPanel.currentPanel.update();
			}
		}
	}));

	if (vscode.window.registerWebviewPanelSerializer) {
		// Make sure we register a serializer in activation event
		vscode.window.registerWebviewPanelSerializer(PetPanel.viewType, {
			async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
				// Reset the webview options so we use latest uri for `localResourceRoots`.
				webviewPanel.webview.options = getWebviewOptions(context.extensionUri);
				const spec = PetSpecification.fromConfiguration();
				PetPanel.revive(webviewPanel, context.extensionUri, context.extensionPath, spec.color, spec.type, spec.size);
			}
		});
	}
}

function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions & vscode.WebviewPanelOptions {
	return {
		// Enable javascript in the webview
		enableScripts: true,
		// And restrict the webview to only loading content from our extension's `media` directory.
		localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
	};
}

/**
 * Some pets can only have certain colors, this makes sure they haven't been misconfigured.
 * @param petColor 
 * @param petType 
 * @returns normalized color
 */
function normalizeColor(petColor: PetColor, petType: PetType): PetColor {
	if (petType === PetType.snake)
		{return PetColor.green;}
	if (petType === PetType.rubberduck)
		{return PetColor.yellow;}
	if ((petType === PetType.dog || 
		petType === PetType.cat) && 
		petColor === PetColor.green)
		{return PetColor.brown;}
	return petColor;
}


class PetsViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'vscode-pets.petsView';

	private _view?: vscode.WebviewView;
	private _petMediaPath: string;
	private _disposables: vscode.Disposable[] | undefined;
	
	constructor(
		private readonly _extensionUri: vscode.Uri, 
		extensionPath: string, 
		petColor: PetColor, 
		petType:PetType, 
		petSize:PetSize	
	) {
		this._petMediaPath = path.join(extensionPath, 'media');
	}

	resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext<unknown>, token: vscode.CancellationToken): void | Thenable<void> {
		this._view = webviewView;

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,

			localResourceRoots: [
				this._extensionUri
			]
		};
		
		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
		
		webviewView.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'alert':
						vscode.window.showErrorMessage(message.text);
						return;
				}
			},
			null,
			this._disposables
		);		
	}
	

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Local path to main script run in the webview
		const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'media', 'main-bundle.js');

		// And the uri we use to load this script in the webview
		const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

		// Local path to css styles
		const styleResetPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css');
		const stylesPathMainPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'pets.css');

		// Uri to load styles into webview
		const stylesResetUri = webview.asWebviewUri(styleResetPath);
		const stylesMainUri = webview.asWebviewUri(stylesPathMainPath);

		// Get path to resource on disk
		const basePetUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._petMediaPath)));

		// Use a nonce to only allow specific scripts to be run
		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${stylesResetUri}" rel="stylesheet">
				<link href="${stylesMainUri}" rel="stylesheet">
				<title>VS Code Pets</title>
			</head>
			<body>
				<canvas id="petCanvas"></canvas><div id="petsContainer"></div>
				<script nonce="${nonce}" src="${scriptUri}"></script>
				<script nonce="${nonce}">petApp.petPanelApp("${basePetUri}", "${PetColor.black}", "${PetSize.nano}", "${PetType.cat}");</script>
				
			</body>
			</html>`;
	}
}

/**
 * Manages pet coding webview panels
 */
class PetPanel {
	/**
	 * Track the currently panel. Only allow a single panel to exist at a time.
	 */
	public static currentPanel: PetPanel | undefined;

	public static readonly viewType = 'petCoding';

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private _disposables: vscode.Disposable[] = [];
	private _petMediaPath: string;
	private _petColor: PetColor;
	private _petType: PetType;
	private _petSize: PetSize;

	public static createOrShow(extensionUri: vscode.Uri, extensionPath: string, petColor: PetColor, petType:PetType, petSize:PetSize) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;
		// If we already have a panel, show it.
		if (PetPanel.currentPanel) {
			if (petColor === PetPanel.currentPanel.petColor() 
				&& petType === PetPanel.currentPanel.petType()
				&& petSize === PetPanel.currentPanel.petSize()) {
				PetPanel.currentPanel._panel.reveal(column);
				return;
			} else {
				PetPanel.currentPanel.updatePetColor(petColor);
				PetPanel.currentPanel.updatePetType(petType);
				PetPanel.currentPanel.updatePetSize(petSize);
				PetPanel.currentPanel.update();
			}
		}

		// Otherwise, create a new panel.
		const panel = vscode.window.createWebviewPanel(
			PetPanel.viewType,
			'Pet Panel',
			vscode.ViewColumn.Two,
			getWebviewOptions(extensionUri),
		);

		PetPanel.currentPanel = new PetPanel(panel, extensionUri, extensionPath, petColor, petType, petSize);
	}

	public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, extensionPath: string, petColor: PetColor, petType: PetType, petSize: PetSize) {
		PetPanel.currentPanel = new PetPanel(panel, extensionUri, extensionPath, petColor, petType, petSize);
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, extensionPath: string, color: PetColor, type: PetType, size: PetSize) {
		this._panel = panel;
		this._extensionUri = extensionUri;
		this._petMediaPath = path.join(extensionPath, 'media');
		this._petColor = color;
		this._petType = type;
		this._petSize = size;
		// Set the webview's initial html content
		this._update();

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programatically
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Update the content based on view changes
		this._panel.onDidChangeViewState(
			e => {
				this.update();
			},
			null,
			this._disposables
		);

		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'alert':
						vscode.window.showErrorMessage(message.text);
						return;
				}
			},
			null,
			this._disposables
		);
	}

	public petColor(): PetColor {
		return normalizeColor(this._petColor, this._petType);
	}

	public petType(): PetType { 
		return this._petType;
	}

	public petSize(): PetSize {
		return this._petSize;
	}

	public updatePetColor(newColor: PetColor){
		this._petColor = newColor;
	}

	public updatePetType(newType: PetType){
		this._petType = newType;
	}

	public updatePetSize(newSize: PetSize){
		this._petSize = newSize;
	}

	public throwBall() {
		this._panel.webview.postMessage({ command: 'throw-ball' });
	}

	public spawnPet(spec: PetSpecification) {
		this._panel.webview.postMessage({ command: 'spawn-pet', type: spec.type, color: spec.color});
	}

	public dispose() {
		PetPanel.currentPanel = undefined;

		// Clean up our resources
		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	public update(){
		if (this._panel.visible) {
			this._update();
		}
	}

	private _update() {
		const webview = this._panel.webview;
		this._panel.webview.html = this._getHtmlForWebview(webview);
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Local path to main script run in the webview
		const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'media', 'main-bundle.js');

		// And the uri we use to load this script in the webview
		const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

		// Local path to css styles
		const styleResetPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css');
		const stylesPathMainPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'pets.css');

		// Uri to load styles into webview
		const stylesResetUri = webview.asWebviewUri(styleResetPath);
		const stylesMainUri = webview.asWebviewUri(stylesPathMainPath);

		// Get path to resource on disk
		const basePetUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._petMediaPath)));

		// Use a nonce to only allow specific scripts to be run
		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${stylesResetUri}" rel="stylesheet">
				<link href="${stylesMainUri}" rel="stylesheet">
				<title>VS Code Pets</title>
			</head>
			<body>
				<canvas id="petCanvas"></canvas><div id="petsContainer"></div>
				<script nonce="${nonce}" src="${scriptUri}"></script>
				<script nonce="${nonce}">petApp.petPanelApp("${basePetUri}", "${this.petColor()}", "${this.petSize()}", "${this.petType()}");</script>
				
			</body>
			</html>`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}