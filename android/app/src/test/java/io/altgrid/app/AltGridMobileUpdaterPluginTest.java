package io.altgrid.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class AltGridMobileUpdaterPluginTest {
    @Test
    public void acceptsWholeNumbersFromEveryCapacitorJsonRepresentation() {
        assertEquals(Long.valueOf(3_148_834L), AltGridMobileUpdaterPlugin.exactLong(3_148_834));
        assertEquals(Long.valueOf(3_148_834L), AltGridMobileUpdaterPlugin.exactLong(3_148_834L));
        assertEquals(Long.valueOf(3_148_834L), AltGridMobileUpdaterPlugin.exactLong(3_148_834D));
    }

    @Test
    public void rejectsMissingFractionalAndNonNumericValues() {
        assertNull(AltGridMobileUpdaterPlugin.exactLong(null));
        assertNull(AltGridMobileUpdaterPlugin.exactLong("3148834"));
        assertNull(AltGridMobileUpdaterPlugin.exactLong(3_148_834.5D));
        assertNull(AltGridMobileUpdaterPlugin.exactLong(Double.NaN));
        assertNull(AltGridMobileUpdaterPlugin.exactLong(Double.POSITIVE_INFINITY));
    }
}
