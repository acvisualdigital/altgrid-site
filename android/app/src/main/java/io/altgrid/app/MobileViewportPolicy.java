package io.altgrid.app;

/**
 * Keeps game pages on one predictable phone-wide breakpoint. Android devices
 * can expose very different CSS viewport widths even when their physical
 * screens look similar. The virtual canvas is wide enough to keep the game
 * controls arranged horizontally without shrinking the whole interface to a
 * desktop-sized 720 px canvas. The WebView's overview mode then fits it to the
 * native session surface.
 */
final class MobileViewportPolicy {
    static final int PORTRAIT_CSS_WIDTH = 480;
    static final int LANDSCAPE_CSS_WIDTH = 854;

    private static final String DOCUMENT_START_SCRIPT =
        "(function(){'use strict';"
        + "if(window.__altGridViewportPolicyInstalled){"
        + "if(window.__altGridApplyViewportPolicy){window.__altGridApplyViewportPolicy();}"
        + "return;}"
        + "window.__altGridViewportPolicyInstalled=true;"
        + "var viewportObserver=null;"
        + "var desiredContent=function(){"
        + "var landscape=window.matchMedia&&window.matchMedia('(orientation: landscape)').matches;"
        + "return landscape?'width=" + LANDSCAPE_CSS_WIDTH
        + ", viewport-fit=cover':'width=" + PORTRAIT_CSS_WIDTH
        + ", viewport-fit=cover';};"
        + "var apply=function(){"
        + "if(!document.head){return;}"
        + "var metas=document.head.querySelectorAll('meta[name=\"viewport\"]');"
        + "if(!metas.length){var meta=document.createElement('meta');"
        + "meta.setAttribute('name','viewport');document.head.insertBefore(meta,document.head.firstChild);"
        + "metas=document.head.querySelectorAll('meta[name=\"viewport\"]');}"
        + "var content=desiredContent();for(var index=0;index<metas.length;index++){"
        + "if(metas[index].getAttribute('content')!==content){"
        + "metas[index].setAttribute('content',content);}}};"
        + "window.__altGridApplyViewportPolicy=apply;"
        + "var start=function(){"
        + "if(!document.head){return false;}apply();"
        + "if(!viewportObserver){viewportObserver=new MutationObserver(function(){apply();});"
        + "viewportObserver.observe(document.head,{childList:true,subtree:true,attributes:true,"
        + "attributeFilter:['name','content']});"
        + "window.addEventListener('orientationchange',apply,{passive:true});"
        + "window.addEventListener('resize',apply,{passive:true});"
        + "window.addEventListener('pageshow',apply,{passive:true});}return true;};"
        + "if(!start()){var bootstrapObserver=new MutationObserver(function(){"
        + "if(start()){bootstrapObserver.disconnect();}});"
        + "bootstrapObserver.observe(document,{childList:true,subtree:true});}"
        + "})();";

    private MobileViewportPolicy() {}

    static String documentStartScript() {
        return DOCUMENT_START_SCRIPT;
    }
}
