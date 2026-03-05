import { ensureQodeAndRelaunch, resolveBundledAssetPath } from "./setup";

type NodeGuiModule = typeof import("@nodegui/nodegui");

function startUi(nodegui: NodeGuiModule): void {
  const { QMainWindow, QWidget, QLabel, QPushButton, QIcon, QBoxLayout, Direction } = nodegui;

  const win = new QMainWindow();
  win.setWindowTitle("Hello World");

  const centralWidget = new QWidget();
  const rootLayout = new QBoxLayout(Direction.TopToBottom);
  centralWidget.setObjectName("myroot");
  centralWidget.setLayout(rootLayout);

  const label = new QLabel();
  label.setObjectName("mylabel");
  label.setText("Hello");

  const button = new QPushButton();
  const logoPath = resolveBundledAssetPath("assets/logox200.png");
  button.setIcon(new QIcon(logoPath));

  const label2 = new QLabel();
  label2.setText("World");
  label2.setInlineStyle(`
    color: red;
  `);

  rootLayout.addWidget(label);
  rootLayout.addWidget(button);
  rootLayout.addWidget(label2);
  win.setCentralWidget(centralWidget);
  win.setStyleSheet(`
    #myroot {
      background-color: #009688;
      height: '100%';
      align-items: 'center';
      justify-content: 'center';
    }
    #mylabel {
      font-size: 16px;
      font-weight: bold;
      padding: 1;
    }
  `);
  win.show();

  (global as { win?: unknown }).win = win;
}

async function main(): Promise<void> {
  await ensureQodeAndRelaunch(["assets/logox200.png"]);
  const nodegui = await import("@nodegui/nodegui");
  startUi(nodegui);
}

main().catch((error: unknown) => {
  console.error("Failed to start app:", error);
  process.exit(1);
});
