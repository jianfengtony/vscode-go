package main

import (
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
)

var (
	src = flag.String("src", "", "source file for parsing")
	c   = 10
)

var (
	a = 10
	b = 20
)

type DeclarationInfo struct {
	StartLine int
	EndLine   int
	DeclType  string
	Name      string
}

func main() {
	flag.Parse()
	// fmt.Printf("go src = %s\n", *src)
	fset := token.NewFileSet()
	astFile, err := parser.ParseFile(fset, *src, nil, parser.DeclarationErrors)
	if err != nil {
		fmt.Println("err = ", err)
		return
	}

	packageName := astFile.Name.Name
	fmt.Printf("%s\n", packageName)

	for _, decl := range astFile.Decls {
		info := DeclarationInfo{}
		start := decl.Pos()
		info.StartLine = fset.Position(start).Line

		end := decl.End()
		endLine := fset.Position(end).Line
		info.EndLine = endLine

		switch decl := decl.(type) {
		case *ast.GenDecl:
			switch decl.Tok {
			case token.IMPORT:
				info.DeclType = "import"
			case token.CONST:
				info.DeclType = "const"
			case token.TYPE:
				info.DeclType = "type"
				info.Name = decl.Specs[0].(*ast.TypeSpec).Name.Name
			case token.VAR:
				info.DeclType = "var"
				// info.Name = decl.Specs[1].(*ast.ValueSpec).Names[0].Name
			default:
				info.DeclType = "GenDecl"
			}
		case *ast.FuncDecl:
			info.DeclType = "func"
			info.Name = decl.Name.Name
		default:
			info.DeclType = "OtherDecl"
		}

		fmt.Printf("%s,%d,%d,%s\n",
			info.DeclType, info.StartLine, info.EndLine, info.Name)
	}
}
