package io.altgrid.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	@Override
	public void onCreate(android.os.Bundle state) {
		registerPlugin(AltGridMobilePlugin.class);
		super.onCreate(state);
	}
}
