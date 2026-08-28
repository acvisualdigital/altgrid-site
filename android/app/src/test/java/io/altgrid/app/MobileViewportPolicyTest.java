package io.altgrid.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class MobileViewportPolicyTest {
    @Test
    public void standardizesPortraitAndLandscapeBreakpointsWithoutBlockingPinchZoom() {
        String script = MobileViewportPolicy.documentStartScript();

        assertTrue(script.contains("width=480, viewport-fit=cover"));
        assertTrue(script.contains("width=854, viewport-fit=cover"));
        assertTrue(script.contains("orientation: landscape"));
        assertFalse(script.contains("user-scalable=no"));
        assertFalse(script.contains("maximum-scale"));
    }

    @Test
    public void observesOnlyTheDocumentHeadAfterBootstrap() {
        String script = MobileViewportPolicy.documentStartScript();

        assertTrue(script.contains("viewportObserver.observe(document.head"));
        assertTrue(script.contains("window.__altGridViewportPolicyInstalled"));
    }
}
