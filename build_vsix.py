#!/usr/bin/env python3
"""Build agy-auto-context-<version>.vsix without vsce (manifest fields XML-escaped)."""
import json, os, zipfile
from xml.sax.saxutils import escape, quoteattr

HERE = os.path.dirname(os.path.abspath(__file__))
FILES = ['package.json', 'extension.js', 'README.md', 'LICENSE']  # LICENSE is stored as LICENSE.txt
pkg = json.load(open(os.path.join(HERE, 'package.json'), encoding='utf-8'))
ver = pkg['version']
kind = ','.join(pkg.get('extensionKind', []))
manifest = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id={quoteattr(pkg['name'])} Version={quoteattr(ver)} Publisher={quoteattr(pkg['publisher'])}/>
    <DisplayName>{escape(pkg.get('displayName', pkg['name']))}</DisplayName>
    <Description xml:space="preserve">{escape(pkg.get('description', ''))}</Description>
    <Categories>{escape(','.join(pkg.get('categories', [])))}</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value={quoteattr(pkg['engines']['vscode'])}/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value={quoteattr(kind)}/>
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
  </Assets>
</PackageManifest>
'''
ctypes = '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json"/>
  <Default Extension=".js" ContentType="application/javascript"/>
  <Default Extension=".md" ContentType="text/markdown"/>
  <Default Extension=".txt" ContentType="text/plain"/>
  <Default Extension=".vsixmanifest" ContentType="text/xml"/>
</Types>
'''
out = os.path.join(HERE, f"{pkg['name']}-{ver}.vsix")
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', ctypes)
    z.writestr('extension.vsixmanifest', manifest)
    for f in FILES:
        z.write(os.path.join(HERE, f), 'extension/' + (f + '.txt' if f == 'LICENSE' else f))
print(out)
