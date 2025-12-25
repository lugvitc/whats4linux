package settings

import (
	"os"
	"reflect"
	"regexp"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

func (c *_settings) setupEnvVars() {
	_ = godotenv.Load()
	val := reflect.ValueOf(c).Elem()
	for i := 0; i < val.NumField(); i++ {
		name := toUpperSnakeCase(val.Type().Field(i).Name)

		envVal, ok := os.LookupEnv(name)
		if !ok {
			continue
		}

		switch val.Type().Field(i).Type.Kind() {
		case reflect.Int:
			ev, _ := strconv.ParseInt(envVal, 10, 64)
			val.Field(i).SetInt(ev)
		case reflect.String:
			val.Field(i).SetString(envVal)
		case reflect.Bool:
			ev, _ := strconv.ParseBool(envVal)
			val.Field(i).SetBool(ev)
		}
	}
}

var matchFirstCap = regexp.MustCompile("(.)([A-Z][a-z]+)")
var matchAllCap = regexp.MustCompile("([a-z0-9])([A-Z])")

func toUpperSnakeCase(str string) string {
	snake := matchFirstCap.ReplaceAllString(str, "${1}_${2}")
	snake = matchAllCap.ReplaceAllString(snake, "${1}_${2}")
	return strings.ToUpper(snake)
}
