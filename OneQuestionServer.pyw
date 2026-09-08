# GUI launcher kept as a convenience. The console controller is the primary
# control surface. This file intentionally shares the same direct server logic
# by importing the console module.
from OneQuestionServer import main_menu

if __name__ == "__main__":
    main_menu()
