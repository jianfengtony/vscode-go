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
				info.DeclType = "Import"
			case token.CONST:
				info.DeclType = "Unclassified"
			case token.TYPE:
				info.DeclType = "Type"
				info.Name = decl.Specs[0].(*ast.TypeSpec).Name.Name
			case token.VAR:
				info.DeclType = "Unclassified"
				// info.Name = decl.Specs[1].(*ast.ValueSpec).Names[0].Name
			default:
				info.DeclType = "Unclassified"
			}
		case *ast.FuncDecl:
			if decl.Recv == nil {
				info.DeclType = "Function"
			} else {
				info.DeclType = "Method"
			}
			info.Name = nameOf(decl)
		default:
			info.DeclType = "Unclassified"
		}

		fmt.Printf("%s,%d,%d,%s\n",
			info.DeclType, info.StartLine, info.EndLine, info.Name)
	}
}

func nameOf(f *ast.FuncDecl) string {
	if r := f.Recv; r != nil && len(r.List) == 1 {
		// looks like a correct receiver declaration
		t := r.List[0].Type
		// dereference pointer receiver types
		if p, _ := t.(*ast.StarExpr); p != nil {
			t = p.X
		}
		// the receiver type must be a type name
		if p, _ := t.(*ast.Ident); p != nil {
			return p.Name + "." + f.Name.Name
		}
		// otherwise assume a function instead
	}
	return f.Name.Name
}
