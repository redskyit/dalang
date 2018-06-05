# dalang
A simplified puppeteer for use with puppeteer.  Includes both an API for use in node, and a scripting language called dalang script.

# Versions 
0.1.4-alpha.2 (latest)
0.1.4-alpha.1
0.1.3

## Overview

dalang abstracts the puppeteer API, allowing the focus to be on writing tests. It 
is a simple yet powerful API and scripting language, designed to take much of the 
pain out of writing and updating automation and regression tests for web pages.  
Puppeteer is a powerful automation tool for google chrome, but it requires a 
fair amount of code to do even the simplest things.  The idea behind dalang and 
dalang script is to hide all the complication inside the API and script engine 
and expose the power of puppeteer through the simplest of APIs or commands.  
Simple and quick was the goal behind this project.

## Release Notes

Version `0.1.3` is now available.

## Example dalang script

    browser headless 0
    browser start
    browser size 1024,768
    browser get "https://github.com/search/"
    wait 30
    select "*[name='q']" 
    send "dalang user:redskyit"
    select "button[type='submit']" 
    click
    sleep 10

## Installation

    npm i dalang --save-dev

## Using dalang API

    const dalang = require('dalang');
    (async () => {
      await dalang.config({ headless: false });
      await dalang.start({ width: 1024, height: 768 });
      await dalang.get('https://github.com/search');
      await dalang.wait(30);
      await dalang.select('*[name="q"]');
      await dalang.send('dalang user:redskyit');
      await dalang.select('button[type="submit"]');
      await dalang.click();
      await dalang.sleep(10);
      await dalang.close();
    })();

## Using dalang script

    const dalang = require('dalang');
    dalang.run('/path/to/script');

## Documentation
### Dalang Script Language Syntax

https://github.com/redskyit/dalang/wiki/Language-Syntax-(v0.1)
