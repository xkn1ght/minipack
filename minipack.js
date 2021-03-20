const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require("@babel/traverse").default;
const {transformFromAst} = require("@babel/core");
const path = require('path');
/**
 * 模拟webpack
 * 缺陷：require缓存、只能从默认main值中开始构建依赖
 * 现有功能：
 * 1. 创建asset对象: filename、dependencies、唯一标识符、code
 *   - 依赖：fs拿到代码、@babe/parser、@babel/traverse拿到依赖信息, @babel/core转换为CMD模块
 * 2. 递归创建依赖图：
 *   - 依赖：path
 * 3. 构造可执行代码：
 *   - 思想：cmd模块的使用，为每一个文件/模块 构造一个执行函数，传入三个形参module、require、exports
 *      - 每次遇到require先进行解析执行，并将模块的exports对象返回
 *      - 回到调用require的模块/文件时，将返回的exports对象交到它的手中使用
 *      - 如此往返，结束整个文件的执行
 */


let ID = 0;

function createAsset(filename) {
    const content = fs.readFileSync(filename, {encoding: 'utf-8'});

    const ast = parser.parse(content, {
        sourceType: "module",
    });

    const dependencies = [];

    traverse(ast, {
        ImportDeclaration(path) {
            dependencies.push(path.node.source.value);
        }
    });

    const {code} = transformFromAst(ast, null, {
        presets: ['@babel/preset-env'],
    });


    const id = ID++;

    return {
        id,
        filename,
        code,
        dependencies
    }
}

function createGraph(entry) {
    // Start by parsing the entry file.
    const mainAsset = createAsset(entry);

    // We're going to use a queue to parse the dependencies of every asset. To do
    // that we are defining an array with just the entry asset.
    const que = [mainAsset];

    // We use a `for ... of` loop to iterate over the queue. Initially the queue
    // only has one asset but as we iterate it we will push additional new assets
    // into the queue. This loop will terminate when the queue is empty.
    for (let q of que) {
        // Every one of our assets has a list of relative paths to the modules it
        // depends on. We are going to iterate over them, parse them with our
        // `createAsset()` function, and track the dependencies this module has in
        // this object.

        // This is the directory this module is in.
        const dirname = path.dirname(q.filename);

        // We iterate over the list of relative paths to its dependencies.
        q.dependencies.forEach(relativePath => {
            // Our `createAsset()` function expects an absolute filename. The
            // dependencies array is an array of relative paths. These paths are
            // relative to the file that imported them. We can turn the relative path
            // into an absolute one by joining it with the path to the directory of
            // the parent asset.
            const absolutePath = path.join(dirname, relativePath);

            // Parse the asset, read its content, and extract its dependencies.
            const asset = createAsset(absolutePath);

            // It's essential for us to know that `asset` depends on `child`. We
            // express that relationship by adding a new property to the `mapping`
            // object with the id of the child.
            q.mapping = {[relativePath]:asset.id};

            // Finally, we push the child asset into the queue so its dependencies
            // will also be iterated over and parsed.
            que.push(asset);
        })
    }
    return que;
}

function bundle(graph){
    let modules = "";

    graph.forEach(mod=>{
        modules+=`${mod.id}:[
        function(module,require,exports){
        ${mod.code}
        },
        ${JSON.stringify(mod.mapping)},
        ],`
    });

    //cmd: (modules,require,exports)

    const result = `
         (function(modules){
            function require(id){
                const [fn,mapping] = modules[id];

                function localRequire(name){
                    return require(mapping[name]);
                }
                const module = {exports:{}};
                fn(module,localRequire,module.exports);
                return module.exports
            }
            require(0);
         })({${modules}});
    `
    return result;
}

const map = createGraph('./src/entry.js');
const result = bundle(map);
eval(result);
