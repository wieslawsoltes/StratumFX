"""Standalone-package and website checks using local inline assets (no network navigation).
This harness is not a GPU/storage/network-browser qualification.
"""
import asyncio, base64, json, os, pathlib, re
from playwright.async_api import async_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]

def inline(path):
    text=path.read_text()
    def script(m):
        f=(path.parent/m.group(1)).resolve()
        return '<script>'+f.read_text().replace('</script','<\\/script')+'</script>'
    text=re.sub(r'<script src="([^"]+)"></script>',script,text)
    text=re.sub(r'<link rel="stylesheet" href="([^"]+)">',lambda m:'<style>'+(path.parent/m.group(1)).resolve().read_text()+'</style>',text)
    def image(m):
        f=(path.parent/m.group(1)).resolve(); mime='image/svg+xml' if f.suffix=='.svg' else 'image/png'
        return 'src="data:'+mime+';base64,'+base64.b64encode(f.read_bytes()).decode()+'"'
    text=re.sub(r'src="([^":]+\.(?:png|svg))"',image,text)
    return text

async def main():
    checks=[]; errors=[]
    async with async_playwright() as p:
        executable=os.environ.get('CHROMIUM_PATH')
        if not executable and pathlib.Path('/usr/bin/chromium').exists(): executable='/usr/bin/chromium'
        args=['--no-sandbox']
        if os.environ.get('STRATUM_TEST_SOFTWARE')=='1': args+=['--disable-webgl','--disable-gpu']
        browser=await p.chromium.launch(executable_path=executable,headless=True,args=args)
        for name in ['engine','renderer','controls']:
            page=await browser.new_page(viewport={'width':1280,'height':900})
            page.on('pageerror',lambda e: errors.append(str(e)))
            await page.set_content(inline(ROOT/f'examples/{name}.html'),wait_until='load')
            await page.wait_for_function('window.exampleResult?.mesh?.vertexCount>0',timeout=30000)
            checks.append({'test':f'{name} example initializes from independent package bundles','pass':True})
            if name=='engine':
                await page.locator('#cook').click()
                assert await page.evaluate('exampleResult.stats.cooked===0')
                checks.append({'test':'Standalone core reuses cached graph output','pass':True})
            elif name=='renderer':
                await page.locator('#shape').select_option('instances')
                assert await page.evaluate('exampleResult.mesh.instanceCount===289')
                await page.locator('#mode').select_option('wire')
                assert await page.evaluate('exampleResult.view.options.mode==="wire"')
                checks.append({'test':'Standalone renderer handles cross-package instancing and shading controls','pass':True})
            elif name=='controls':
                await page.locator('#add').click()
                assert await page.evaluate('exampleResult.store.document.nodes.length===3')
                await page.locator('#undo').click()
                assert await page.evaluate('exampleResult.store.document.nodes.length===2')
                await page.locator('stratum-timeline .frame').fill('8')
                await page.locator('stratum-timeline .frame').press('Tab')
                assert await page.evaluate('exampleResult.timeline.frame===8')
                checks.append({'test':'Standalone controls host adds nodes, undoes and scrubs timeline','pass':True})
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            checks.append({'test':f'{name} desktop example has no horizontal overflow','pass':True})
            await page.close()
        page=await browser.new_page(viewport={'width':1440,'height':1050})
        # Root landing-page paths are resolved relative to dist/index.html.
        await page.set_content(inline(ROOT/'dist/index.html'),wait_until='load')
        await page.wait_for_function('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)')
        assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert await page.locator('h1').count()==1
        await page.screenshot(path=str(ROOT/'artifacts/site-preview.png'),full_page=True)
        checks.append({'test':'Landing page renders actual image assets without desktop overflow','pass':True})
        await page.set_viewport_size({'width':390,'height':844})
        assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        checks.append({'test':'Landing page has no horizontal overflow at 390px','pass':True})
        await page.screenshot(path=str(ROOT/'artifacts/site-mobile-preview.png'),full_page=True)
        await page.set_content(inline(ROOT/'docs/guide.html'),wait_until='load')
        assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        checks.append({'test':'Guide renders without mobile horizontal overflow','pass':True})
        assert not errors, errors
        await browser.close()
    report={'checks':checks,'passed':len(checks),'pageErrors':errors,'mode':'inline local assets','gpuQualified':False}
    (ROOT/'artifacts/examples-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

asyncio.run(main())
